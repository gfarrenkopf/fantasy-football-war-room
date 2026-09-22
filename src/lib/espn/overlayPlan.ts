import { bestOnBoard, type Counts } from "@/lib/draft/sim/cpu";
import type { SimContext } from "@/lib/draft/sim/context";
import type { PlanEntry, TurnPlan } from "@/lib/draft/sim/turnPlan";
import { roundOf } from "@/lib/draft/snake";
import type { Player, Position } from "@/lib/draft/types";
import { valueTag, valueTagLabel } from "@/lib/draft/value";

/**
 * The turn plan as the ESPN overlay shows it (8.14): the war room's "Your next turn" panel, trimmed
 * to what fits in a corner of ESPN's draft room. The war room builds and publishes it; the server
 * adds each player's ESPN id so the overlay can draft him; the bridge renders it.
 */

export interface OverlayPlayer {
  playerId: string;
  /** Filled in by the server; the overlay can only draft players that have one. */
  espnPlayerId?: number;
  name: string;
  pos: Position;
  team: string;
  bye: number;
  /** The badge: survival odds ("100%") for plan players, overall rank ("#84") for the best on the board. */
  badge: string;
  /** Value/Reach label ("+25 Value", "-19 Reach Risk"), when there is one worth showing. */
  tag?: { kind: "value" | "reach"; label: string };
}

export interface OverlayPlan {
  /** Pick numbers of the turn, e.g. [108] or [24, 25]. */
  picks: number[];
  /** Round(s) of the turn, e.g. "11" or "2/3". */
  rounds: string;
  /** The user is on the clock for this turn. */
  onClock: boolean;
  targets: OverlayPlayer[];
  fallbacks: OverlayPlayer[];
  /** Best on the board right now for the user's needs, outside the plan. */
  best: OverlayPlayer[];
  /** The turn after this one, by name. */
  after: { picks: number[]; names: string[] } | null;
}

const MAX_EACH = 4;

function tagFor(player: Player, threshold: number): OverlayPlayer["tag"] {
  const tag = valueTag(player, threshold);
  return tag.kind === "value" || tag.kind === "reach" ? { kind: tag.kind, label: valueTagLabel(tag) } : undefined;
}

const fromEntry = (e: PlanEntry, threshold: number): OverlayPlayer => ({
  playerId: e.player.id,
  name: e.player.name,
  pos: e.player.pos,
  team: e.player.team,
  bye: e.player.bye,
  badge: `${Math.round(e.survival * 100)}%`,
  tag: tagFor(e.player, threshold),
});

/** Builds the overlay's plan from the same pieces the war room's plan panel uses. */
export function buildOverlayPlan({
  now,
  next,
  onClock,
  taken,
  counts,
  current,
  ctx,
  valueThreshold,
}: {
  now: TurnPlan;
  next: TurnPlan | null;
  onClock: boolean;
  taken: ReadonlySet<string>;
  /** The user's roster counts by position, for "best on the board" needs. */
  counts: Counts;
  /** The pick on the clock. */
  current: number;
  ctx: SimContext;
  valueThreshold: number;
}): OverlayPlan {
  const inPlan = new Set([...now.targets, ...now.fallbacks, ...now.letGo].map((e) => e.player.id));
  const round = roundOf(Math.min(current, ctx.total), ctx.league.teams);
  const best = bestOnBoard(new Set(taken), counts, round, ctx, MAX_EACH, inPlan);
  return {
    picks: now.picks,
    rounds: [...new Set(now.picks.map((n) => roundOf(n, ctx.league.teams)))].join("/"),
    onClock,
    targets: now.targets.slice(0, MAX_EACH).map((e) => fromEntry(e, valueThreshold)),
    fallbacks: now.fallbacks.slice(0, MAX_EACH).map((e) => fromEntry(e, valueThreshold)),
    best: best.map((p) => ({ playerId: p.id, name: p.name, pos: p.pos, team: p.team, bye: p.bye, badge: `#${p.consensusRank}`, tag: tagFor(p, valueThreshold) })),
    after: next ? { picks: next.picks, names: next.targets.filter((e) => !taken.has(e.player.id)).map((e) => e.player.name).slice(0, MAX_EACH) } : null,
  };
}

/* ---------------- validation (the server's view of a published plan) ---------------- */

const POSITIONS = new Set<string>(["QB", "RB", "WR", "TE", "K", "DST"]);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const ints = (v: unknown, max: number): v is number[] => Array.isArray(v) && v.length <= max && v.every((n) => Number.isInteger(n) && n > 0 && n < 10_000);

function parsePlayer(raw: unknown): OverlayPlayer | null {
  const p = (raw ?? {}) as Partial<OverlayPlayer>;
  if (!str(p.playerId, 120) || !str(p.name, 80) || !POSITIONS.has(p.pos as string) || !str(p.team, 4) || !Number.isInteger(p.bye) || !str(p.badge, 8)) return null;
  const tag = p.tag && (p.tag.kind === "value" || p.tag.kind === "reach") && str(p.tag.label, 24) ? { kind: p.tag.kind, label: p.tag.label } : undefined;
  return { playerId: p.playerId, name: p.name, pos: p.pos!, team: p.team, bye: p.bye!, badge: p.badge, ...(tag ? { tag } : {}) };
}

function parsePlayers(raw: unknown): OverlayPlayer[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_EACH) return null;
  const players = raw.map(parsePlayer);
  return players.every((p): p is OverlayPlayer => p !== null) ? players : null;
}

/** A published plan, validated and rebuilt from known fields; null if anything is off. ESPN ids are the server's to add. */
export function parseOverlayPlan(raw: unknown): OverlayPlan | null {
  const p = (raw ?? {}) as Partial<OverlayPlan>;
  if (!ints(p.picks, 4) || !p.picks.length || !str(p.rounds, 12) || typeof p.onClock !== "boolean") return null;
  const targets = parsePlayers(p.targets);
  const fallbacks = parsePlayers(p.fallbacks);
  const best = parsePlayers(p.best);
  if (!targets || !fallbacks || !best) return null;
  let after: OverlayPlan["after"] = null;
  if (p.after) {
    if (!ints(p.after.picks, 4) || !Array.isArray(p.after.names) || p.after.names.length > MAX_EACH || !p.after.names.every((n) => str(n, 80))) return null;
    after = { picks: p.after.picks, names: p.after.names };
  }
  return { picks: p.picks, rounds: p.rounds, onClock: p.onClock, targets, fallbacks, best, after };
}
