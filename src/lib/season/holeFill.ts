import { label, snapshotOf, type SuggestedMove } from "./apply";
import type { Fill, Hole } from "./holes";
import type { LineupMove } from "./lineup";
import type { LineupSlot } from "./types";
import type { SeasonView } from "./view";

/**
 * Filling a hole (APE-404), as the web's hole card and the app's "Fill it" both do it: the hole's
 * player to IR when that makes room, the add with its drop, then the start. ESPN checks each write
 * against the roster the one before it left, so each step carries that roster.
 */

type Snapshot = { playerId: number; slot: LineupSlot }[];

export interface FillPlan {
  /** The hole's player to IR first; null when the fill doesn't use IR. */
  ir: { snapshot: Snapshot; move: LineupMove } | null;
  add: { snapshot: Snapshot; add: number; drop: number | null };
  start: { snapshot: Snapshot; moves: LineupMove[]; suggested: SuggestedMove[] };
  /** The starter who goes to the bench for him; null when the slot has an open seat. */
  out: number | null;
}

/** The steps that fill `hole` with `fill`, from the roster in `view`; null when the fill's IR player isn't on it. */
export function fillPlan(view: SeasonView, hole: Pick<Hole, "key" | "playerId">, fill: Fill): FillPlan | null {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const add = fill.player.playerId;
  let now: Snapshot = snapshotOf(roster);

  let ir: FillPlan["ir"] = null;
  if (fill.ir !== null) {
    const from = now.find((p) => p.playerId === fill.ir)?.slot;
    if (!from) return null;
    ir = { snapshot: now, move: { playerId: fill.ir, from, to: "IR" } };
    now = now.map((p) => (p.playerId === fill.ir ? { ...p, slot: "IR" as const } : p));
  }

  const adding = { snapshot: now, add, drop: fill.drop };
  now = [...now.filter((p) => p.playerId !== fill.drop), { playerId: add, slot: "BN" }];

  // The hole's own player makes way first; otherwise, with the slot full, the one projecting least.
  const seats = view.starters.find((s) => s.key === hole.key)?.count ?? 1;
  const there = now.filter((p) => p.slot === hole.key);
  const points = (id: number) => roster.find((p) => p.playerId === id)?.points ?? 0;
  const out = there.length < seats ? null : (there.find((p) => p.playerId === hole.playerId) ?? [...there].sort((a, b) => points(a.playerId) - points(b.playerId))[0]).playerId;
  const holder = hole.playerId === null ? 0 : points(hole.playerId);

  return {
    ir,
    add: adding,
    start: {
      snapshot: now,
      moves: [{ playerId: add, from: "BN", to: hole.key }, ...(out === null ? [] : [{ playerId: out, from: hole.key, to: "BN" as const }])],
      suggested: [{ playerId: add, to: hole.key, gain: fill.player.points - holder }],
    },
    out,
  };
}

/** Each step of `plan` in plain words, in order: "Move Lamar Jackson to IR", "Add Joe Flacco and drop Broncos D/ST", "Start Joe Flacco at QB". */
export function fillSteps(plan: FillPlan, slot: LineupSlot, name: (id: number) => string): string[] {
  const add = name(plan.add.add);
  return [
    ...(plan.ir ? [`Move ${name(plan.ir.move.playerId)} to IR`] : []),
    `Add ${add}${plan.add.drop === null ? "" : ` and drop ${name(plan.add.drop)}`}`,
    `Start ${add} at ${label(slot)}${plan.out === null ? "" : ` over ${name(plan.out)}`}`,
  ];
}
