import { SLOT_DEFS } from "@/lib/draft/league";
import type { Trade, TradeVerdict } from "@/lib/season/trade";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { withDeadline } from "../generatePlan";
import { PlanModelError, type JsonSchema, type ModelEffort, type ModelUsage, type PlanModel } from "../provider";
import { clip, injuryTag, isObject, refError } from "./shared";

/**
 * The AI trade write-up (Epic 11, 11.2). The trade verdict (10.6) has already measured what the
 * trade does to each team's best lineup for the rest of the season; the model explains it and leans
 * accept, decline or counter. It sees both rosters, so a counter-offer can name players, by ref.
 */

/** Bump when the prompt or the input it's built from changes meaningfully. Recorded with each write-up. */
export const TRADE_PROMPT_VERSION = 1;

export type TradeLean = "accept" | "decline" | "counter";
const LEANS: readonly TradeLean[] = ["accept", "decline", "counter"];

export interface TradeInputPlayer {
  ref: string;
  playerId: number;
  name: string;
  pos: ViewPlayer["pos"];
  team: string | null;
  /** "you" or "them": whose roster he's on now. */
  side: "you" | "them";
  moving: boolean;
  ros: number;
  /** Rest-of-season points in the fantasy playoffs; null when the playoff weeks aren't known. */
  playoffs: number | null;
  /** The remaining weeks he's projected 0 with a team: byes. */
  byes: number[];
  injury: string | null;
}

export interface TradeInputSide {
  name: string;
  before: number;
  after: number;
  delta: number;
  perWeek: number;
  /** Starting slots whose weekly points change by at least half a point. */
  slots: { key: string; before: number; after: number }[];
  /** Refs of players they'd have to cut to fit the roster. */
  drops: string[];
}

export interface TradeInput {
  season: number;
  week: number;
  finalWeek: number;
  playoffStartWeek: number | null;
  weeks: number;
  you: TradeInputSide;
  them: TradeInputSide;
  players: TradeInputPlayer[];
}

export interface AiTradeWriteup {
  lean: TradeLean;
  summary: string;
  reasons: string[];
  /** A counter-offer idea, as player ids; null when there's no obvious one. */
  counter: { give: number[]; get: number[]; note: string } | null;
}

const byes = (p: ViewPlayer) =>
  p.projected && p.team !== null && p.ros > 0
    ? Object.entries(p.weekly)
        .filter(([, pts]) => pts === 0)
        .map(([week]) => Number(week))
    : [];

/** The model's input: the verdict for both sides, and both rosters. */
export function buildTradeInput(view: SeasonView, trade: Trade, verdict: TradeVerdict): TradeInput {
  const mine = view.teams.find((t) => t.id === trade.teamA)!;
  const theirs = view.teams.find((t) => t.id === trade.teamB)!;
  const moving = new Set([...trade.gives, ...trade.gets]);
  const all = [...mine.roster.map((p) => ({ p, side: "you" as const })), ...theirs.roster.map((p) => ({ p, side: "them" as const }))];
  const refOf = new Map(all.map(({ p }, i) => [p.playerId, `p${i + 1}`]));
  const playoffs = (p: ViewPlayer) => {
    if (view.playoffStartWeek === null) return null;
    let sum = 0;
    for (let w = Math.max(view.playoffStartWeek, view.currentWeek); w <= view.finalWeek; w++) sum += p.weekly[w] ?? 0;
    return Math.round(sum * 10) / 10;
  };
  const side = (name: string, v: TradeVerdict["a"]): TradeInputSide => ({
    name,
    before: round(v.before),
    after: round(v.after),
    delta: round(v.delta),
    perWeek: round(v.perWeek),
    slots: v.bySlot.filter((s) => Math.abs(s.after - s.before) >= 0.5).map((s) => ({ key: s.key, before: round(s.before), after: round(s.after) })),
    drops: v.drops.map((id) => refOf.get(id)!),
  });
  return {
    season: view.season,
    week: view.currentWeek,
    finalWeek: view.finalWeek,
    playoffStartWeek: view.playoffStartWeek,
    weeks: verdict.weeks,
    you: side(mine.name, verdict.a),
    them: side(theirs.name, verdict.b),
    players: all.map(({ p, side }) => ({
      ref: refOf.get(p.playerId)!,
      playerId: p.playerId,
      name: p.name,
      pos: p.pos,
      team: p.team,
      side,
      moving: moving.has(p.playerId),
      ros: round(p.ros),
      playoffs: playoffs(p),
      byes: byes(p),
      injury: injuryTag(p.injuryStatus),
    })),
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

export const TRADE_SYSTEM_PROMPT = `You are a fantasy football analyst advising one manager on a trade offer. A trade engine has already measured the trade: for each team, the best legal starting lineup's projected points for every remaining week, before and after the trade. That measurement is the core of your advice; explain it, don't redo it.

What matters, in order:
- The engine's change in rest-of-season lineup points for the manager ("you"). A trade that fills a positional hole shows up as a big gain in that slot; a 2-for-1 that only moves bench depth shows up as little.
- The fantasy playoffs: players' projected points in the playoff weeks, if given. A regular-season gain that costs playoff points is worth less.
- Byes: moving players whose byes cluster with the manager's starters.
- The other team's side, because a trade they'd refuse helps nobody.

Output rules:
- lean: accept, decline or counter. Counter only when a small change would make it fair or better for the manager.
- summary: 1-2 sentences with the verdict and the number that drives it.
- reasons: 2-4 short sentences.
- counter: when you lean counter, the players to give and get instead, as refs: give from "you", get from "them". Otherwise empty lists and an empty note.
- Answer lists with refs, the bracketed ids such as p12. Text names players, never refs.
- Everything must come from the tables: no outside news, injuries, depth charts, schedules or team situations beyond what's listed.`;

function sideLines(label: string, s: TradeInputSide): string[] {
  const slots = s.slots.map((x) => `${SLOT_DEFS.find((d) => d.key === x.key)?.label ?? x.key} ${x.before} → ${x.after}`).join(", ");
  return [
    `${label} (${s.name}): best-lineup points ${s.before} → ${s.after} (${s.delta >= 0 ? "+" : ""}${s.delta}, ${s.perWeek >= 0 ? "+" : ""}${s.perWeek} a week)`,
    `  slots per week: ${slots || "no change"}`,
    ...(s.drops.length ? [`  would cut to fit the roster: ${s.drops.join(", ")}`] : []),
  ];
}

export function buildTradePrompt(input: TradeInput): { system: string; user: string } {
  const playoffs = input.playoffStartWeek === null ? "Playoff weeks unknown." : `Playoffs: weeks ${input.playoffStartWeek}-${input.finalWeek}.`;
  const row = (p: TradeInputPlayer) =>
    [
      `[${p.ref}] ${p.name}, ${p.pos} ${p.team ?? "FA"}`,
      `ROS ${p.ros}`,
      ...(p.playoffs === null ? [] : [`playoffs ${p.playoffs}`]),
      `bye ${p.byes.length ? p.byes.join("/") : "-"}`,
      p.injury ?? "-",
    ].join(" | ");
  const trade = (side: "you" | "them") => input.players.filter((p) => p.side === side && p.moving).map((p) => `${p.name} [${p.ref}]`).join(", ") || "nobody";
  const lines = [
    `${input.season}, week ${input.week}; ${input.weeks} weeks left through week ${input.finalWeek}. ${playoffs}`,
    "",
    `The trade: you send ${trade("you")}; you get ${trade("them")}.`,
    "",
    ...sideLines("You", input.you),
    ...sideLines("Them", input.them),
    "",
    "Players: [ref] name, position team | rest-of-season points | playoff-week points | bye weeks left | injury",
    "## Your roster",
    ...input.players.filter((p) => p.side === "you").map((p) => (p.moving ? `${row(p)} | TRADED` : row(p))),
    "## Their roster",
    ...input.players.filter((p) => p.side === "them").map((p) => (p.moving ? `${row(p)} | TRADED` : row(p))),
  ];
  return { system: TRADE_SYSTEM_PROMPT, user: lines.join("\n") };
}

const refList = { type: "array", items: { type: "string", description: "A player ref such as p12." } };

export const TRADE_OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lean", "summary", "reasons", "counter"],
  properties: {
    lean: { type: "string", enum: [...LEANS] },
    summary: { type: "string" },
    reasons: { type: "array", items: { type: "string" } },
    counter: {
      type: "object",
      additionalProperties: false,
      required: ["give", "get", "note"],
      properties: { give: refList, get: refList, note: { type: "string" } },
    },
  },
};

const LIMITS = { summary: 400, reason: 300, reasons: 4, note: 300 };

export type TradeValidation = { ok: true; writeup: AiTradeWriteup; issues: string[] } | { ok: false; issues: string[] };

/**
 * Checks a model response against its input. A ref that isn't in the input rejects the response. A
 * counter that gives away their player, or asks for yours, is dropped and reported, as is a counter
 * with nobody in it; the lean then stays as written.
 */
export function validateTradeWriteup(raw: unknown, input: TradeInput): TradeValidation {
  if (!isObject(raw) || typeof raw.lean !== "string" || !LEANS.includes(raw.lean as TradeLean)) return { ok: false, issues: ["response is not a trade write-up"] };
  const players = new Map(input.players.map((p) => [p.ref, p]));
  const issues: string[] = [];
  const counterRaw = isObject(raw.counter) ? raw.counter : {};
  const refs = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
  const give = refs(counterRaw.give);
  const get = refs(counterRaw.get);
  const unknown = [...give, ...get].find((r) => !players.has(r));
  if (unknown) return { ok: false, issues: [refError(unknown)] };

  let counter: AiTradeWriteup["counter"] = null;
  if (give.length || get.length) {
    if (give.some((r) => players.get(r)!.side !== "you") || get.some((r) => players.get(r)!.side !== "them")) issues.push("dropped a counter with players on the wrong side");
    else counter = { give: [...new Set(give)].map((r) => players.get(r)!.playerId), get: [...new Set(get)].map((r) => players.get(r)!.playerId), note: clip(counterRaw.note, LIMITS.note) };
  }
  const reasons = (Array.isArray(raw.reasons) ? raw.reasons : []).map((r) => clip(r, LIMITS.reason)).filter(Boolean).slice(0, LIMITS.reasons);
  const summary = clip(raw.summary, LIMITS.summary);
  if (!summary) return { ok: false, issues: ["no summary"] };
  return { ok: true, writeup: { lean: raw.lean as TradeLean, summary, reasons, counter }, issues };
}

export interface GeneratedTradeWriteup {
  writeup: AiTradeWriteup;
  issues: string[];
  provider: string;
  model: string;
  usage: ModelUsage;
  durationMs: number;
}

const MAX_OUTPUT_TOKENS = 8_000;

/** Throws PlanModelError when the provider fails or the response is unusable, so the caller can fall back. */
export async function generateTradeWriteup(
  model: PlanModel,
  input: TradeInput,
  { signal, effort = "low" }: { signal?: AbortSignal; effort?: ModelEffort } = {},
): Promise<GeneratedTradeWriteup> {
  const start = performance.now();
  const { system, user } = buildTradePrompt(input);
  const call = model.generate({ system, user, schema: TRADE_OUTPUT_SCHEMA, maxTokens: MAX_OUTPUT_TOKENS, effort, signal });
  const { json, usage } = await (signal ? withDeadline(call, signal) : call);
  const result = validateTradeWriteup(json, input);
  if (!result.ok) throw new PlanModelError("invalid_output", `Unusable trade write-up: ${result.issues.join("; ")}`, usage);
  return { writeup: result.writeup, issues: result.issues, provider: model.provider, model: model.model, usage, durationMs: performance.now() - start };
}
