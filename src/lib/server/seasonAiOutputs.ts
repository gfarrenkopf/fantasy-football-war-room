import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { costUsd } from "@/lib/ai/pricing";
import { PlanModelError, type ModelUsage, type PlanModel, type PlanModelErrorKind } from "@/lib/ai/provider";
import { buildLineupInput, generateAiLineup, LINEUP_PROMPT_VERSION, type AiLineup } from "@/lib/ai/season/lineup";
import { espnStartersOf } from "@/lib/ai/season/lineupStatus";
import type { StoredAiOutput } from "@/lib/ai/season/state";
import { buildTradeInput, generateTradeWriteup, TRADE_PROMPT_VERSION, type AiTradeWriteup } from "@/lib/ai/season/trade";
import { aiGenerations, seasonAiOutputs, type GenerationPurpose, type SeasonAiOutputKind, type SeasonAiUseKind } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { evaluateTrade, type Trade } from "@/lib/season/trade";
import type { SeasonView } from "@/lib/season/view";
import { claimSeasonAiUse, releaseSeasonAiUse } from "./seasonAi";

/**
 * Writing and keeping in-season AI outputs (11.2). Each is stored, so a reload shows the same lineup
 * or write-up without paying for another: lineups per league, week and kind, trade write-ups per
 * league, week and trade. Every model call is logged in `ai_generations`, failures included.
 * Access (seasonAi.ts) is the caller's job.
 */

/** A model call that runs past this is abandoned, and the free result shows instead. */
export const SEASON_AI_TIMEOUT_MS = 90_000;

export type StoredOutput<T> = StoredAiOutput<T>;

export type WriteResult<T> =
  | ({ status: "ok"; cached: boolean } & StoredOutput<T>)
  /** This week's allowance of that lineup is already used. */
  | { status: "used" }
  /** The trade isn't between two teams in the league, or moves nobody. */
  | { status: "invalid-trade" }
  /** The model failed; nothing was stored, and a lineup's allowance was given back. */
  | { status: "failed"; kind: PlanModelErrorKind };

interface Where {
  leagueId: string;
  season: number;
  week: number;
  kind: SeasonAiOutputKind;
  key?: string;
}

async function findOutput<T>(db: Db, w: Where): Promise<StoredOutput<T> | null> {
  const [row] = await db
    .select({ output: seasonAiOutputs.output, createdAt: seasonAiOutputs.createdAt })
    .from(seasonAiOutputs)
    .where(and(eq(seasonAiOutputs.leagueId, w.leagueId), eq(seasonAiOutputs.season, w.season), eq(seasonAiOutputs.week, w.week), eq(seasonAiOutputs.kind, w.kind), eq(seasonAiOutputs.key, w.key ?? "")));
  return row ? { output: row.output as T, createdAt: row.createdAt.toISOString() } : null;
}

/** This week's stored AI lineups for a league, by kind. */
export async function findAiLineups(db: Db, leagueId: string, season: number, week: number): Promise<Partial<Record<SeasonAiUseKind, StoredOutput<AiLineup>>>> {
  const rows = await db
    .select({ kind: seasonAiOutputs.kind, output: seasonAiOutputs.output, createdAt: seasonAiOutputs.createdAt })
    .from(seasonAiOutputs)
    .where(and(eq(seasonAiOutputs.leagueId, leagueId), eq(seasonAiOutputs.season, season), eq(seasonAiOutputs.week, week), eq(seasonAiOutputs.key, "")));
  return Object.fromEntries(rows.filter((r) => r.kind !== "trade").map((r) => [r.kind, { output: r.output as AiLineup, createdAt: r.createdAt.toISOString() }]));
}

/** Which trade this is, whichever order its players were picked in. */
export function tradeKey(trade: Trade): string {
  const ids = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
  return createHash("sha256")
    .update(JSON.stringify([TRADE_PROMPT_VERSION, trade.teamA, ids(trade.gives), trade.teamB, ids(trade.gets)]))
    .digest("hex")
    .slice(0, 32);
}

/** The stored write-up for this trade this week, if there is one. */
export function findTradeWriteup(db: Db, leagueId: string, view: SeasonView, trade: Trade): Promise<StoredOutput<AiTradeWriteup> | null> {
  return findOutput(db, { leagueId, season: view.season, week: view.currentWeek, kind: "trade", key: tradeKey(trade) });
}

interface Call {
  db: Db;
  model: PlanModel;
  userId: string;
  leagueId: string;
  purpose: GenerationPurpose;
  promptVersion: number;
}

/**
 * Runs one model call and logs it, however it ends. Returns the result, or the failure kind for a
 * PlanModelError; anything else is rethrown for the route to log.
 */
async function logged<T extends { usage: ModelUsage }>(c: Call, run: (signal: AbortSignal) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; kind: PlanModelErrorKind }> {
  const startedAt = performance.now();
  const log = (outcome: PlanModelErrorKind | "ready" | "internal", usage?: ModelUsage) => logGeneration(c, { startedAt, outcome, usage });
  try {
    const value = await run(AbortSignal.timeout(SEASON_AI_TIMEOUT_MS));
    await log("ready", value.usage);
    return { ok: true, value };
  } catch (error) {
    if (!(error instanceof PlanModelError)) {
      await log("internal");
      throw error;
    }
    await log(error.kind, error.usage);
    return { ok: false, kind: error.kind };
  }
}

/** Records one model call in `ai_generations`. Never throws: losing a log line mustn't lose the output. */
async function logGeneration(c: Call, entry: { startedAt: number; outcome: PlanModelErrorKind | "ready" | "internal"; usage?: ModelUsage }) {
  const { usage } = entry;
  try {
    await c.db.insert(aiGenerations).values({
      leagueId: c.leagueId,
      userId: c.userId,
      jobId: crypto.randomUUID(),
      purpose: c.purpose,
      provider: c.model.provider,
      model: c.model.model,
      promptVersion: c.promptVersion,
      outcome: entry.outcome,
      inputTokens: usage?.inputTokens ?? null,
      cachedInputTokens: usage ? (usage.cachedInputTokens ?? 0) : null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd: usage ? costUsd(c.model.provider, c.model.model, usage) : null,
      durationMs: Math.round(performance.now() - entry.startedAt),
    });
  } catch (error) {
    console.warn(`[season-ai] couldn't log a generation: ${(error as Error).message}`);
  }
}

/**
 * This week's AI lineup of `kind` for the user's team: the stored one, or a new one, which uses the
 * week's allowance. A failed call gives the allowance back.
 */
export async function writeAiLineup(
  db: Db,
  model: PlanModel,
  { userId, leagueId, view, kind }: { userId: string; leagueId: string; view: SeasonView; kind: SeasonAiUseKind },
): Promise<WriteResult<AiLineup>> {
  const where = { leagueId, season: view.season, week: view.currentWeek, kind };
  const stored = await findOutput<AiLineup>(db, where);
  if (stored) return { status: "ok", cached: true, ...stored };
  if (!(await claimSeasonAiUse(db, where))) {
    // Someone else's request may have just written it.
    const raced = await findOutput<AiLineup>(db, where);
    return raced ? { status: "ok", cached: true, ...raced } : { status: "used" };
  }
  try {
    const input = buildLineupInput(view);
    const result = await logged({ db, model, userId, leagueId, purpose: "season-lineup", promptVersion: LINEUP_PROMPT_VERSION }, (signal) => generateAiLineup(model, input, { signal }));
    if (!result.ok) {
      await releaseSeasonAiUse(db, where);
      return { status: "failed", kind: result.kind };
    }
    const { issues, provider, model: modelId } = result.value;
    const mine = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
    const lineup: AiLineup = { ...result.value.lineup, espnStarters: espnStartersOf(mine) };
    const [row] = await db
      .insert(seasonAiOutputs)
      .values({ ...where, output: lineup, issues, provider, model: modelId, promptVersion: LINEUP_PROMPT_VERSION })
      .returning({ createdAt: seasonAiOutputs.createdAt });
    return { status: "ok", cached: false, output: lineup, createdAt: row.createdAt.toISOString() };
  } catch (error) {
    await releaseSeasonAiUse(db, where).catch(() => {});
    throw error;
  }
}

/**
 * The AI write-up of a trade from the user's side (`trade.teamA` is theirs): the stored one for this
 * week, or a new one. The verdict is recomputed here from the server's view, never taken from the client.
 */
export async function writeTradeWriteup(
  db: Db,
  model: PlanModel,
  { userId, leagueId, view, trade }: { userId: string; leagueId: string; view: SeasonView; trade: Trade },
): Promise<WriteResult<AiTradeWriteup>> {
  if (trade.teamA !== view.myTeamId) return { status: "invalid-trade" };
  const verdict = evaluateTrade(view.teams, view, trade);
  if (!verdict) return { status: "invalid-trade" };
  const where = { leagueId, season: view.season, week: view.currentWeek, kind: "trade" as const, key: tradeKey(trade) };
  const stored = await findOutput<AiTradeWriteup>(db, where);
  if (stored) return { status: "ok", cached: true, ...stored };

  const input = buildTradeInput(view, trade, verdict);
  const result = await logged({ db, model, userId, leagueId, purpose: "season-trade", promptVersion: TRADE_PROMPT_VERSION }, (signal) => generateTradeWriteup(model, input, { signal }));
  if (!result.ok) return { status: "failed", kind: result.kind };
  const { writeup, issues, provider, model: modelId } = result.value;
  // Two requests for the same trade at once both pay; the first one stored is the one everyone sees.
  await db.insert(seasonAiOutputs).values({ ...where, output: writeup, issues, provider, model: modelId, promptVersion: TRADE_PROMPT_VERSION }).onConflictDoNothing();
  const saved = (await findOutput<AiTradeWriteup>(db, where))!;
  return { status: "ok", cached: false, ...saved };
}
