import { SLOT_DEFS } from "@/lib/draft/league";
import { ESPN_SLOT_ID } from "./espnLeague";
import type { LineupMove } from "./lineup";
import type { LineupSlot, LineupSlotCount, RosterEntry } from "./types";

/**
 * Applying a lineup to ESPN (12.1, docs/in-season.md §7). Pure: the checks the browser runs while
 * the user stages moves, and the server runs again on a fresh read of the roster before it writes.
 * ESPN has no dry run and doesn't check `fromLineupSlotId`, so these checks are the only ones before
 * a write lands on the user's real team.
 */

type StarterKey = LineupSlotCount["key"];

/** What the checks need of a roster entry. */
export type ApplyEntry = Pick<RosterEntry, "playerId" | "name" | "pos" | "slot" | "espnSlotId" | "locked"> & Partial<Pick<RosterEntry, "injuryStatus">>;

/**
 * The injury statuses ESPN lets onto IR (13.2). ESPN refuses anyone it doesn't mark injured
 * (`TRAN_ROSTER_INELIGIBLE_IR_NOT_INJURED`), and marks injured exactly the players it lists as OUT
 * or on injured reserve (docs/espn-protocol.md §8).
 */
export const IR_STATUSES: ReadonlySet<string> = new Set(["OUT", "INJURY_RESERVE"]);

export const irEligible = (p: Pick<ApplyEntry, "injuryStatus">) => IR_STATUSES.has(p.injuryStatus ?? "");

/** One `LINEUP` item of ESPN's `ROSTER` transaction. */
export interface EspnLineupItem {
  playerId: number;
  type: "LINEUP";
  fromLineupSlotId: number;
  toLineupSlotId: number;
}

/** Every starting slot, one entry per seat: RB twice for two RBs. */
export const starterSeats = (starters: readonly LineupSlotCount[]): StarterKey[] => starters.flatMap((s) => Array.from({ length: s.count }, () => s.key));

const ELIGIBLE = new Map<LineupSlot, readonly ApplyEntry["pos"][]>(SLOT_DEFS.map((d) => [d.key, d.eligible]));

/** Whether a player at this position may sit in this slot. The bench takes anyone. */
export const canPlay = (pos: ApplyEntry["pos"], slot: LineupSlot) => slot === "BN" || (ELIGIBLE.get(slot)?.includes(pos) ?? false);

/**
 * The lineup ESPN has now, seat by seat: who sits in each seat of `starterSeats()`, in roster order,
 * or null where ESPN has the slot empty. Staging from here and changing nothing makes no moves.
 */
export function seatsFromRoster(roster: readonly ApplyEntry[], seats: readonly StarterKey[]): (number | null)[] {
  const queue = new Map<LineupSlot, number[]>();
  for (const p of roster) queue.set(p.slot, [...(queue.get(p.slot) ?? []), p.playerId]);
  return seats.map((key) => queue.get(key)?.shift() ?? null);
}

/**
 * The moves that turn the roster as ESPN has it into a staged lineup: `staged` names who sits in
 * each seat of `starterSeats()`, or null to leave it empty, and `ir` who should be on IR (13.2).
 * A player not staged anywhere goes to the bench; without `ir`, IR is left alone. A player staged in
 * a seat of the slot they already hold doesn't move.
 */
export function movesToStaged(roster: readonly ApplyEntry[], seats: readonly StarterKey[], staged: readonly (number | null)[], ir?: readonly number[]): LineupMove[] {
  const target = new Map<number, LineupSlot>();
  seats.forEach((key, i) => {
    const id = staged[i];
    if (id !== null && id !== undefined) target.set(id, key);
  });
  for (const id of ir ?? []) target.set(id, "IR");
  return roster.flatMap((p) => {
    if (p.slot === "IR" && !ir) return [];
    const to = target.get(p.playerId) ?? "BN";
    return to === p.slot ? [] : [{ playerId: p.playerId, from: p.slot, to }];
  });
}

/**
 * The moves in the groups the user sees as one change: a player who takes a seat is tied to the
 * player who held it on ESPN, so a bench swap (Higgins out, Love in at WR) or a chain through FLEX is
 * made or left out whole. `before` is `seatsFromRoster()`, `after` the staged lineup. Groups keep the
 * order of their first move.
 */
export function groupMoves(moves: readonly LineupMove[], before: readonly (number | null)[], after: readonly (number | null)[]): LineupMove[][] {
  const parent = new Map<number, number>();
  const root = (id: number): number => {
    const up = parent.get(id) ?? id;
    if (up === id) return id;
    const top = root(up);
    parent.set(id, top);
    return top;
  };
  before.forEach((out, i) => {
    const into = after[i];
    if (out !== null && into !== null && into !== undefined && out !== into) parent.set(root(out), root(into));
  });
  const groups = new Map<number, LineupMove[]>();
  for (const m of moves) groups.set(root(m.playerId), [...(groups.get(root(m.playerId)) ?? []), m]);
  return [...groups.values()];
}

/**
 * Why these moves can't be sent to ESPN, in words for the user; empty when they can. The moves
 * must be the user's own players, where the roster says they are, unlocked, into slots they're
 * eligible for (IR only for the injured), and must leave a lineup that fits the league's slots,
 * bench and IR.
 */
export function checkMoves(roster: readonly ApplyEntry[], moves: readonly LineupMove[], starters: readonly LineupSlotCount[], benchSize: number, irSlots = 0): string[] {
  if (!moves.length) return ["There's nothing to change."];
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const problems: string[] = [];
  const seen = new Set<number>();
  const slotOf = new Map(roster.map((p) => [p.playerId, p.slot]));

  for (const move of moves) {
    const p = byId.get(move.playerId);
    if (!p) {
      problems.push(`Player ${move.playerId} isn't on your team.`);
      continue;
    }
    if (seen.has(p.playerId)) problems.push(`${p.name} is moved twice.`);
    seen.add(p.playerId);
    if (p.slot !== move.from) problems.push(`${p.name} is at ${label(p.slot)} on ESPN, not ${label(move.from)}.`);
    else if (move.to === move.from) problems.push(`${p.name} is already at ${label(move.to)}.`);
    if (move.to === "IR") {
      if (!irEligible(p)) problems.push(`${p.name} isn't hurt enough for IR: ESPN only takes players who are out or on injured reserve.`);
    } else if (!canPlay(p.pos, move.to)) problems.push(`${p.name} can't play ${label(move.to)}.`);
    if (p.locked) problems.push(`${p.name}'s game has started, so ESPN won't move them this week.`);
    slotOf.set(p.playerId, move.to);
  }

  const count = new Map<LineupSlot, number>();
  for (const slot of slotOf.values()) count.set(slot, (count.get(slot) ?? 0) + 1);
  for (const { key, count: max } of starters) {
    const n = count.get(key) ?? 0;
    if (n > max) problems.push(`That's ${n} players at ${label(key)}; the league starts ${max}.`);
  }
  for (const [slot, n] of count) {
    if (slot !== "BN" && slot !== "IR" && !starters.some((s) => s.key === slot) && n > 0) problems.push(`This league has no ${label(slot)} slot.`);
  }
  // A roster already over the bench limit (ESPN lets IR returns sit there) may stay over, not grow.
  const benchNow = roster.filter((p) => p.slot === "BN").length;
  const benchNext = count.get("BN") ?? 0;
  if (benchNext > Math.max(benchSize, benchNow)) problems.push(`That leaves ${benchNext} players on a ${benchSize}-player bench.`);
  const irNow = roster.filter((p) => p.slot === "IR").length;
  const irNext = count.get("IR") ?? 0;
  if (irNext > irNow && irNext > irSlots) problems.push(irSlots ? `That's ${irNext} players on IR; the league has ${irSlots} IR ${irSlots === 1 ? "spot" : "spots"}.` : "This league has no IR spots.");
  return [...new Set(problems)];
}

/** The moves as ESPN's `LINEUP` items. `fromLineupSlotId` is ESPN's own id from the roster, never derived. */
export function toEspnItems(roster: readonly ApplyEntry[], moves: readonly LineupMove[]): EspnLineupItem[] {
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  return moves.map((m) => ({ playerId: m.playerId, type: "LINEUP", fromLineupSlotId: byId.get(m.playerId)!.espnSlotId, toLineupSlotId: ESPN_SLOT_ID[m.to] }));
}

/** Where each player sat when the user staged their moves. */
export type RosterSnapshot = readonly { playerId: number; slot: LineupSlot }[];

export const snapshotOf = (roster: readonly ApplyEntry[]): { playerId: number; slot: LineupSlot }[] => roster.map((p) => ({ playerId: p.playerId, slot: p.slot }));

/**
 * What changed on ESPN between staging and now, in words: players added, dropped or moved. Any
 * change aborts the apply, because the staged moves were chosen against the old roster.
 */
export function rosterChanges(staged: RosterSnapshot, now: readonly ApplyEntry[]): string[] {
  const before = new Map(staged.map((p) => [p.playerId, p.slot]));
  const changes: string[] = [];
  for (const p of now) {
    const was = before.get(p.playerId);
    if (was === undefined) changes.push(`${p.name} joined your roster.`);
    else if (was !== p.slot) changes.push(`${p.name} moved from ${label(was)} to ${label(p.slot)}.`);
    before.delete(p.playerId);
  }
  if (before.size) changes.push(before.size === 1 ? "A player left your roster." : `${before.size} players left your roster.`);
  return changes;
}

/** Whether each move is what ESPN shows now. */
export function landedMoves(moves: readonly LineupMove[], after: readonly ApplyEntry[]): (LineupMove & { landed: boolean })[] {
  const slotOf = new Map(after.map((p) => [p.playerId, p.slot]));
  return moves.map((m) => ({ ...m, landed: slotOf.get(m.playerId) === m.to }));
}

/**
 * ESPN's refusal of any roster transaction (`409`, `details[].type`) in plain words. Unknown types fall back to ESPN's own message.
 */
export function espnRefusal(type: string, message: string): string {
  switch (type) {
    case "TRAN_ROSTER_INELIGIBLE_SLOT":
      return `ESPN says a player isn't eligible for that slot: ${message}`;
    case "TRAN_ROSTER_SLOT_LIMIT_EXCEEDED":
      return `ESPN says a slot would be over its limit: ${message}`;
    case "TRAN_LINEUP_LOCKED":
      return `ESPN says a player's game has started, so they can't move this week: ${message}`;
    case "TRAN_ROSTER_SAME_SLOT":
      return `ESPN says a player is already in that slot, so your lineup has changed since this page loaded: ${message}`;
    case "TRAN_ROSTER_INELIGIBLE_IR_NOT_INJURED":
      return `ESPN only puts injured players on IR: ${message}`;
    case "TRAN_ROSTER_LIMIT_EXCEEDED_ONE":
      return `ESPN says your roster would be over its limit, so drop a player too: ${message}`;
    case "TRAN_PLAYER_NOT_FREEAGENT":
      return `ESPN says the player isn't a free agent any more: ${message}`;
    default:
      return message ? `ESPN refused the change: ${message}` : `ESPN refused the change (${type}).`;
  }
}

const LABEL: Record<LineupSlot, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FLEX: "FLEX", SUPERFLEX: "OP", DST: "D/ST", K: "K", BN: "the bench", IR: "IR" };

/** A slot as the user reads it: "RB", "OP", "the bench". */
export const label = (slot: LineupSlot) => LABEL[slot];
