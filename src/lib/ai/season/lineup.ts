import { SLOT_DEFS } from "@/lib/draft/league";
import { isRuledOut, type LineupPlan } from "@/lib/season/lineup";
import type { LineupSlot, LineupSlotCount } from "@/lib/season/types";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { withDeadline } from "../generatePlan";
import { PlanModelError, type JsonSchema, type ModelEffort, type ModelUsage, type PlanModel } from "../provider";
import { clip, injuryTag, isObject, refError } from "./shared";

/**
 * The AI lineup (Epic 11, 11.2). The engine's optimal lineup (10.5) decides; the model explains it,
 * and may change it only on a close call: a starter and a bench player within CLOSE_POINTS of each
 * other this week. Same contract as the draft plan: the model sees the table and answers with refs,
 * and anything it says about a player must come from that table.
 */

/** Bump when the prompt or the input it's built from changes meaningfully. Recorded with each lineup. */
export const LINEUP_PROMPT_VERSION = 1;

/** Projected points this close count as a coin flip the model may call either way. */
export const CLOSE_POINTS = 2;

type StarterKey = LineupSlotCount["key"];

export interface LineupInputPlayer {
  ref: string;
  playerId: number;
  name: string;
  pos: ViewPlayer["pos"];
  team: string | null;
  points: number;
  ros: number;
  /** ESPN's injury designation, when it's anything but healthy. */
  injury: string | null;
  locked: boolean;
  /** Where ESPN has him now. */
  now: LineupSlot;
  /** No game this week (projected, but 0 this week). */
  bye: boolean;
}

export interface LineupInputSlot {
  ref: string;
  key: StarterKey;
  /** The engine's pick, a player ref; null when nobody can fill it. */
  engine: string | null;
  /** Who may start here: the engine's pick first, then bench players within CLOSE_POINTS. */
  options: string[];
  locked: boolean;
  /** The model writes a reason for this slot: it's a close call, or it changes on ESPN. */
  decide: boolean;
}

export interface LineupInput {
  season: number;
  week: number;
  players: LineupInputPlayer[];
  slots: LineupInputSlot[];
  engineTotal: number;
  currentTotal: number;
}

/** One starting slot of a written AI lineup. */
export interface AiLineupSlot {
  key: StarterKey;
  playerId: number | null;
  /** The engine's pick; differs from `playerId` when the model called a close call the other way. */
  enginePlayerId: number | null;
  locked: boolean;
  /** Why, for a decided slot. */
  reason: string | null;
}

export interface AiLineup {
  intro: string;
  slots: AiLineupSlot[];
  /** Projected points of these starters. */
  total: number;
  /**
   * Who started on ESPN when it was written (12.1), sorted, so the page can tell when the user has
   * since changed their lineup and the intro's comparison with ESPN is out of date. Missing on
   * lineups written before it was recorded.
   */
  espnStarters?: number[];
}

const label = (key: StarterKey) => SLOT_DEFS.find((d) => d.key === key)?.label ?? key;

/** The model's input, from the season page's view of the user's team. */
export function buildLineupInput(view: SeasonView): LineupInput {
  const mine = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const plan: LineupPlan = view.lineup;
  const refOf = new Map(mine.map((p, i) => [p.playerId, `p${i + 1}`]));
  const starting = new Set(plan.starters.flatMap((f) => (f.playerId === null ? [] : [f.playerId])));
  const eligible = new Map(SLOT_DEFS.map((d) => [d.key, d.eligible]));
  // Bench players who could start: not ruled out, not locked, not on IR.
  const spare = mine.filter((p) => !starting.has(p.playerId) && p.slot !== "IR" && !p.locked && !isRuledOut(p.injuryStatus));
  const now = new Map<StarterKey, number[]>();
  for (const p of mine) if (p.slot !== "BN" && p.slot !== "IR") now.set(p.slot, [...(now.get(p.slot) ?? []), p.playerId]);

  const slots = plan.starters.map((f, i): LineupInputSlot => {
    const engine = f.playerId === null ? null : refOf.get(f.playerId)!;
    const close =
      f.locked || f.playerId === null
        ? []
        : spare.filter((p) => eligible.get(f.key)?.includes(p.pos) && p.points >= f.points - CLOSE_POINTS).sort((a, b) => b.points - a.points || a.playerId - b.playerId);
    const moved = f.playerId !== null && !(now.get(f.key) ?? []).includes(f.playerId);
    return {
      ref: `s${i + 1}`,
      key: f.key,
      engine,
      options: [...(engine ? [engine] : []), ...close.map((p) => refOf.get(p.playerId)!)],
      locked: f.locked,
      decide: !f.locked && engine !== null && (close.length > 0 || moved),
    };
  });

  return {
    season: view.season,
    week: view.currentWeek,
    players: mine.map((p) => ({
      ref: refOf.get(p.playerId)!,
      playerId: p.playerId,
      name: p.name,
      pos: p.pos,
      team: p.team,
      points: p.points,
      ros: p.ros,
      injury: injuryTag(p.injuryStatus),
      locked: p.locked,
      now: p.slot,
      bye: p.projected && p.team !== null && p.points === 0 && p.ros > 0,
    })),
    slots,
    engineTotal: plan.total,
    currentTotal: plan.currentTotal,
  };
}

export const LINEUP_SYSTEM_PROMPT = `You are a fantasy football analyst setting one manager's starting lineup for this NFL week. A lineup engine has already picked the lineup with the most projected points. Your job is to explain its decisions, and to make the call on close ones.

You get the manager's roster with this week's projections, and every starting slot with the engine's pick and the players allowed there.

How to decide:
- Projections come first. Only where a slot lists more than one option are the projections within ${CLOSE_POINTS} points of each other: a coin flip. There you may start any listed option. Use what the table shows: injury designations (a questionable player carries risk a healthy one doesn't), rest-of-season value for nothing, projections for everything.
- Everywhere else, keep the engine's pick.

Output rules:
- Answer with refs, the bracketed ids such as p4 and s2, not player names.
- calls: one entry for every slot marked "decide", in order, with the player you start there and a one-sentence reason. Use only that slot's options.
- A reason names players, never refs. Everything in it must come from the table: no outside news, matchups, weather, depth charts or team situations.
- intro: 1-3 sentences on the week: how many points the lineup projects against the one set on ESPN now, and the calls that matter most.`;

const SLOT_WORD: Record<LineupSlot, string> = { ...Object.fromEntries(SLOT_DEFS.map((d) => [d.key, d.key === "BN" ? "bench" : d.label])), IR: "IR" } as Record<LineupSlot, string>;

export function buildLineupPrompt(input: LineupInput): { system: string; user: string } {
  const byRef = new Map(input.players.map((p) => [p.ref, p]));
  const lines = [
    `${input.season}, week ${input.week}. The engine's lineup projects ${input.engineTotal.toFixed(1)} points; the one set on ESPN now projects ${input.currentTotal.toFixed(1)}.`,
    "",
    "Roster: [ref] name, position team | projected points this week | rest of season | on ESPN now | flags",
    ...input.players.map((p) => {
      const flags = [p.injury, p.locked ? "game started, locked" : null, p.bye ? "bye week" : null].filter(Boolean).join(", ");
      return [`[${p.ref}] ${p.name}, ${p.pos} ${p.team ?? "FA"}`, `${p.points.toFixed(1)} pts`, `ROS ${Math.round(p.ros)}`, `now ${SLOT_WORD[p.now]}`, flags || "-"].join(" | ");
    }),
    "",
    "Starting slots: [ref] slot | engine's pick | options | decide?",
    ...input.slots.map((s) => {
      const pick = s.engine ? `${byRef.get(s.engine)!.name} [${s.engine}]` : "empty";
      const options = s.options.map((r) => `${r} ${byRef.get(r)!.points.toFixed(1)}`).join(", ") || "-";
      return `[${s.ref}] ${label(s.key)} | ${pick}${s.locked ? " (locked)" : ""} | ${options} | ${s.decide ? "decide" : "keep"}`;
    }),
    "",
    `Return calls for: ${input.slots.filter((s) => s.decide).map((s) => s.ref).join(", ") || "none (write only the intro)"}.`,
  ];
  return { system: LINEUP_SYSTEM_PROMPT, user: lines.join("\n") };
}

export const LINEUP_OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intro", "calls"],
  properties: {
    intro: { type: "string" },
    calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot", "ref", "reason"],
        properties: {
          slot: { type: "string", description: "A slot ref such as s2." },
          ref: { type: "string", description: "A player ref such as p4." },
          reason: { type: "string" },
        },
      },
    },
  },
};

const LIMITS = { intro: 600, reason: 300 };

export type LineupValidation = { ok: true; lineup: AiLineup; issues: string[] } | { ok: false; issues: string[] };

/**
 * Checks a model response against its input. Never trusts the model: a ref that isn't in the input
 * rejects the whole response (it's talking about someone else's team). A start outside the slot's
 * options, or a player started twice, falls back to the engine's pick and is reported. A decided
 * slot with no call keeps the engine's pick without a reason.
 */
export function validateAiLineup(raw: unknown, input: LineupInput): LineupValidation {
  if (!isObject(raw) || !Array.isArray(raw.calls)) return { ok: false, issues: ["response is not a lineup object"] };
  const players = new Map(input.players.map((p) => [p.ref, p]));
  const slots = new Map(input.slots.map((s) => [s.ref, s]));
  const issues: string[] = [];

  const calls = new Map<string, { ref: string; reason: string }>();
  for (const c of raw.calls) {
    if (!isObject(c) || typeof c.slot !== "string" || typeof c.ref !== "string") {
      issues.push("dropped a malformed call");
      continue;
    }
    if (!slots.has(c.slot)) return { ok: false, issues: [refError(c.slot)] };
    if (!players.has(c.ref)) return { ok: false, issues: [refError(c.ref)] };
    if (!calls.has(c.slot)) calls.set(c.slot, { ref: c.ref, reason: clip(c.reason, LIMITS.reason) });
  }

  const chosen = input.slots.map((s) => {
    const call = s.decide ? calls.get(s.ref) : undefined;
    if (s.decide && !call) issues.push(`${s.ref}: no call; kept the engine's pick`);
    if (!s.decide && calls.has(s.ref)) issues.push(`${s.ref}: not a decision; kept the engine's pick`);
    if (call && !s.options.includes(call.ref)) {
      issues.push(`${s.ref}: ${call.ref} isn't an option there; kept the engine's pick`);
      return { ref: s.engine, reason: null };
    }
    return { ref: call?.ref ?? s.engine, reason: call?.reason || null };
  });
  // The engine's lineup never starts anyone twice, so reverting departures always ends the loop.
  for (;;) {
    const seen = new Map<string, number>();
    const clash = chosen.findIndex((c, i) => {
      if (!c.ref) return false;
      const first = seen.get(c.ref);
      seen.set(c.ref, i);
      return first !== undefined;
    });
    if (clash < 0) break;
    // Keep the earlier start unless only the later one is the engine's.
    const other = chosen.findIndex((c) => c.ref === chosen[clash].ref);
    const i = chosen[clash].ref !== input.slots[clash].engine ? clash : other;
    issues.push(`${input.slots[i].ref}: ${chosen[i].ref} already starts elsewhere; kept the engine's pick`);
    chosen[i] = { ref: input.slots[i].engine, reason: null };
  }

  const idOf = (ref: string | null) => (ref ? players.get(ref)!.playerId : null);
  const lineupSlots = input.slots.map((s, i): AiLineupSlot => ({ key: s.key, playerId: idOf(chosen[i].ref), enginePlayerId: idOf(s.engine), locked: s.locked, reason: chosen[i].reason }));
  const total = chosen.reduce((sum, c) => sum + (c.ref ? players.get(c.ref)!.points : 0), 0);
  return { ok: true, lineup: { intro: clip(raw.intro, LIMITS.intro), slots: lineupSlots, total: Math.round(total * 100) / 100 }, issues };
}

export interface GeneratedLineup {
  lineup: AiLineup;
  issues: string[];
  provider: string;
  model: string;
  usage: ModelUsage;
  durationMs: number;
}

/** A lineup is a few hundred tokens of JSON; the rest is headroom for a model that reasons first. */
const MAX_OUTPUT_TOKENS = 8_000;

/** Throws PlanModelError when the provider fails or the response is unusable, so the caller can fall back. */
export async function generateAiLineup(
  model: PlanModel,
  input: LineupInput,
  { signal, effort = "low" }: { signal?: AbortSignal; effort?: ModelEffort } = {},
): Promise<GeneratedLineup> {
  const start = performance.now();
  const { system, user } = buildLineupPrompt(input);
  const call = model.generate({ system, user, schema: LINEUP_OUTPUT_SCHEMA, maxTokens: MAX_OUTPUT_TOKENS, effort, signal });
  const { json, usage } = await (signal ? withDeadline(call, signal) : call);
  const result = validateAiLineup(json, input);
  if (!result.ok) throw new PlanModelError("invalid_output", `Unusable lineup: ${result.issues.join("; ")}`, usage);
  return { lineup: result.lineup, issues: result.issues, provider: model.provider, model: model.model, usage, durationMs: performance.now() - start };
}
