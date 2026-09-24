import { SLOT_DEFS } from "@/lib/draft/league";
import type { Position } from "@/lib/draft/types";
import { maxWeightAssignment } from "./assign";
import type { InjuryStatus, LineupSlot, LineupSlotCount } from "./types";

/**
 * The optimal lineup (10.5): the legal starting lineup with the most projected points this week.
 *
 * - Locked players (their game has started) stay exactly where they are, and so does anyone on IR.
 * - A player ruled out (OUT, IR, suspended) is never started while anyone else could be.
 * - Among equally good lineups, the one closest to what's set on ESPN wins, so the list of moves is
 *   as short as it can be.
 */

type StarterKey = LineupSlotCount["key"];

export interface LineupCandidate {
  playerId: number;
  pos: Position;
  /** Where the player sits on ESPN now. */
  slot: LineupSlot;
  locked: boolean;
  injuryStatus: InjuryStatus;
  /** Projected points this week; 0 on a bye. */
  points: number;
}

export interface SlotFill {
  key: StarterKey;
  playerId: number | null;
  points: number;
  locked: boolean;
}

export interface LineupMove {
  playerId: number;
  from: LineupSlot;
  to: LineupSlot;
}

export interface LineupPlan {
  starters: SlotFill[];
  bench: number[];
  /** Projected points of the recommended starters, and of the ones set on ESPN now. */
  total: number;
  currentTotal: number;
  /** What to change on ESPN to get there. Empty when the lineup is already optimal. */
  moves: LineupMove[];
}

const RULED_OUT = new Set(["OUT", "INJURY_RESERVE", "SUSPENSION"]);

/** ESPN says the player won't play this week. */
export const isRuledOut = (status: InjuryStatus) => RULED_OUT.has(status);

const ELIGIBLE = new Map(SLOT_DEFS.map((d) => [d.key, d.eligible]));
const eligible = (pos: Position, key: StarterKey) => ELIGIBLE.get(key)?.includes(pos) ?? false;

/** Any available player beats an empty slot, whatever they project (a D/ST can project negative). */
const FILLED = 1e6;
/** Points are worth far more than keeping a player where they are... */
const PER_POINT = 1e4;
/** ...which only breaks ties. */
const KEEP = 1;

export function optimalLineup(players: readonly LineupCandidate[], starters: readonly LineupSlotCount[]): LineupPlan {
  const instances: StarterKey[] = starters.flatMap((s) => Array.from({ length: s.count }, () => s.key));
  const fills: SlotFill[] = instances.map((key) => ({ key, playerId: null, points: 0, locked: false }));
  const placed = new Map<number, LineupSlot>();

  // Locked starters hold their slot; locked bench players and IR stay put.
  for (const p of players) {
    if (p.slot === "IR") placed.set(p.playerId, "IR");
    else if (p.locked) {
      const at = p.slot === "BN" ? -1 : fills.findIndex((f) => f.playerId === null && f.key === p.slot);
      if (at >= 0) fills[at] = { key: fills[at].key, playerId: p.playerId, points: p.points, locked: true };
      placed.set(p.playerId, at >= 0 ? fills[at].key : "BN");
    }
  }

  const free = players.filter((p) => !placed.has(p.playerId));
  const open = fills.map((f, i) => (f.playerId === null ? i : -1)).filter((i) => i >= 0);
  // Rows: free players, then one "nobody" per open slot. Columns: open slots, then one bench seat per free player.
  const size = free.length + open.length;
  const weight = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col): number => {
      const player = free[row];
      if (col >= open.length) return player && player.slot === "BN" ? KEEP : 0;
      if (!player) return 0;
      const key = fills[open[col]].key;
      if (!eligible(player.pos, key)) return -Infinity;
      const keep = player.slot === key ? KEEP : 0;
      return isRuledOut(player.injuryStatus) ? -1 + keep : FILLED + player.points * PER_POINT + keep;
    }),
  );
  const assigned = maxWeightAssignment(weight);
  free.forEach((p, row) => {
    const col = assigned[row];
    if (col < open.length) {
      const at = open[col];
      fills[at] = { key: fills[at].key, playerId: p.playerId, points: p.points, locked: false };
      placed.set(p.playerId, fills[at].key);
    } else placed.set(p.playerId, "BN");
  });

  return {
    starters: fills,
    bench: players.filter((p) => placed.get(p.playerId) === "BN").map((p) => p.playerId),
    total: fills.reduce((sum, f) => sum + f.points, 0),
    currentTotal: players.filter((p) => p.slot !== "BN" && p.slot !== "IR").reduce((sum, p) => sum + p.points, 0),
    moves: players.flatMap((p) => {
      const to = placed.get(p.playerId)!;
      return to === p.slot ? [] : [{ playerId: p.playerId, from: p.slot, to }];
    }),
  };
}

/** One starting slot, as set on ESPN now and as recommended. */
export interface LineupRow {
  key: StarterKey;
  now: number | null;
  next: number | null;
  changed: boolean;
  /** The recommended player's game has started: neither side can change. */
  locked: boolean;
}

/**
 * The ESPN lineup and the recommended one, row by row (10.8). A player who starts in both keeps the
 * same row, so only the slots that change look different; a slot ESPN has empty shows as null.
 */
export function compareLineups(players: readonly LineupCandidate[], plan: LineupPlan): LineupRow[] {
  const rows: LineupRow[] = plan.starters.map((f) => ({ key: f.key, now: null, next: f.playerId, changed: false, locked: f.locked }));
  const byKey = new Map<StarterKey, number[]>();
  for (const p of players) {
    if (p.slot === "BN" || p.slot === "IR") continue;
    const list = byKey.get(p.slot) ?? [];
    list.push(p.playerId);
    byKey.set(p.slot, list);
  }
  // Same player, same slot: same row.
  for (const row of rows) {
    const list = byKey.get(row.key) ?? [];
    const at = row.next === null ? -1 : list.indexOf(row.next);
    if (at >= 0) {
      row.now = row.next;
      list.splice(at, 1);
    }
  }
  // Whoever else ESPN has in that slot fills its remaining rows, in order.
  for (const row of rows) if (row.now === null) row.now = byKey.get(row.key)?.shift() ?? null;
  for (const row of rows) row.changed = row.now !== row.next;
  return rows;
}
