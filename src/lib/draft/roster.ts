import {
  LATE_POSITIONS,
  POSITIONS,
  type DraftPick,
  type Player,
  type Position,
  type RosterSlot,
  type RosterSlotKey,
} from "./types";

/** A player on the user's roster, with the overall pick number he was taken at. */
export type RosteredPlayer = Player & { pickNo: number };

export interface FilledSlot {
  slot: RosterSlot;
  player: RosteredPlayer | null;
}

export type PlayerLookup = (id: string) => Player | undefined;

const isBench = (s: RosterSlot) => s.key === "BN";
/** A slot any single position can fill (QB, RB, ..., K). */
const isDedicated = (s: RosterSlot) => !isBench(s) && s.eligible.length === 1;
/** FLEX, SUPERFLEX, or any custom multi-position slot. */
const isFlex = (s: RosterSlot) => !isBench(s) && s.eligible.length > 1;

export const isStarterSlot = (s: RosterSlot) => !isBench(s);

/** The user's picks as rostered players, in pick order. */
export function myPlayers(picks: DraftPick[], lookup: PlayerLookup): RosteredPlayer[] {
  const out: RosteredPlayer[] = [];
  picks.forEach((pick, i) => {
    const player = pick.mine ? lookup(pick.playerId) : undefined;
    if (player) out.push({ ...player, pickNo: i + 1 });
  });
  return out;
}

/**
 * Assigns the user's players to roster slots, ported from the prototype's buildRoster():
 * 1. in pick order, each player takes the first open dedicated slot for his position;
 * 2. flex slots (narrowest first, so FLEX fills before SUPERFLEX) take the best-ranked eligible leftover;
 * 3. remaining players go to the bench in pick order.
 * Players who don't fit anywhere (more picks than roster spots) are returned in `overflow`.
 */
export function buildRoster(
  picks: DraftPick[],
  lookup: PlayerLookup,
  roster: RosterSlot[],
): { slots: FilledSlot[]; overflow: RosteredPlayer[] } {
  const slots: FilledSlot[] = roster.map((slot) => ({ slot, player: null }));
  let left: RosteredPlayer[] = [];

  for (const p of myPlayers(picks, lookup)) {
    const open = slots.find((s) => !s.player && isDedicated(s.slot) && s.slot.eligible.includes(p.pos));
    if (open) open.player = p;
    else left.push(p);
  }

  const flexSlots = slots
    .filter((s) => isFlex(s.slot))
    .sort((a, b) => a.slot.eligible.length - b.slot.eligible.length);
  for (const s of flexSlots) {
    const best = left
      .filter((p) => s.slot.eligible.includes(p.pos))
      .sort((a, b) => a.consensusRank - b.consensusRank)[0];
    if (best) {
      s.player = best;
      left = left.filter((p) => p !== best);
    }
  }

  const overflow: RosteredPlayer[] = [];
  for (const p of left) {
    const bench = slots.find((s) => !s.player && isBench(s.slot));
    if (bench) bench.player = p;
    else overflow.push(p);
  }

  return { slots, overflow };
}

/**
 * The slot a rostered player landed in, as the roster panel would name it: "WR2" when the league
 * has more than one WR slot, "FLEX" or "QB" when it has one, "Bench" for the bench. Null when the
 * player isn't on the roster (not the user's, or overflow past the last slot).
 */
export function slotLabel(slots: FilledSlot[], playerId: string): string | null {
  const i = slots.findIndex((s) => s.player?.id === playerId);
  if (i < 0) return null;
  const { key } = slots[i].slot;
  if (key === "BN") return "Bench";
  const name = key === "DST" ? "D/ST" : key;
  const same = slots.filter((s) => s.slot.key === key);
  return same.length > 1 ? `${name}${same.indexOf(slots[i]) + 1}` : name;
}

/** Starters who count toward bye conflicts: every non-bench slot except K and D/ST, which are streamable. */
export function byeRelevantStarters(slots: FilledSlot[]): RosteredPlayer[] {
  return slots
    .filter((s) => isStarterSlot(s.slot) && s.player && !LATE_POSITIONS.includes(s.player.pos))
    .map((s) => s.player!);
}

export interface ByeConflict {
  /** Starters out that week, including this player. 2 = warning, 3+ = severe. */
  n: number;
  /** The other starters out that week, as "Name (POS)". */
  who: string[];
}

/**
 * Starters sharing a bye week, ported from the prototype's conflicts().
 * Count-based regardless of position: 2+ starters out in a week flags every one of them.
 */
export function conflicts(slots: FilledSlot[]): Map<string, ByeConflict> {
  const byWeek = new Map<number, RosteredPlayer[]>();
  for (const p of byeRelevantStarters(slots)) {
    byWeek.set(p.bye, [...(byWeek.get(p.bye) ?? []), p]);
  }
  const bad = new Map<string, ByeConflict>();
  for (const group of byWeek.values()) {
    if (group.length < 2) continue;
    for (const p of group) {
      bad.set(p.id, { n: group.length, who: group.filter((x) => x !== p).map((x) => `${x.name} (${x.pos})`) });
    }
  }
  return bad;
}

/**
 * Would drafting this player now create a starter bye conflict for him?
 * Ported from the prototype's byeClash(). Callers may cache by `${pos}-${bye}` per render.
 */
export function byeClash(
  player: Player,
  picks: DraftPick[],
  lookup: PlayerLookup,
  roster: RosterSlot[],
): ByeConflict | null {
  if (LATE_POSITIONS.includes(player.pos)) return null;
  const withPlayer = [...picks, { playerId: player.id, mine: true }];
  const extended: PlayerLookup = (id) => (id === player.id ? player : lookup(id));
  return conflicts(buildRoster(withPlayer, extended, roster).slots).get(player.id) ?? null;
}

/** Starter count out per bye week, for the byes panel. */
export function starterByeCounts(slots: FilledSlot[], weeks: number[]): { week: number; n: number }[] {
  const starters = byeRelevantStarters(slots);
  return weeks.map((week) => ({ week, n: starters.filter((p) => p.bye === week).length }));
}

/** Distinct bye weeks in a dataset, ascending. */
export const byeWeekList = (byeWeeks: Record<string, number>): number[] =>
  [...new Set(Object.values(byeWeeks))].sort((a, b) => a - b);

/** Number of the user's players at each position. */
export function positionCounts(players: Pick<Player, "pos">[]): Record<Position, number> {
  const counts = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  for (const p of players) counts[p.pos]++;
  return counts;
}

/* ================= needs strip ================= */

export interface NeedGroup {
  key: Exclude<RosterSlotKey, "BN">;
  label: string;
  /** One entry per starter slot of this key: filled or not. */
  filled: boolean[];
  /** Bench players at this position (0 for flex groups). */
  benchCount: number;
  /** An unfilled starter slot the user should be thinking about now. */
  open: boolean;
  /** Open, but safe to wait on (K/D/ST before the late rounds, or FLEX while a dedicated slot is still empty). */
  soft: boolean;
  /** Open and late enough to be a problem. */
  urgent: boolean;
}

export interface RosterNeeds {
  groups: NeedGroup[];
  bench: { filled: number; total: number };
  /** Labels of open, non-soft groups, e.g. ["RB", "TE"]. */
  need: string[];
  urgentAny: boolean;
  allStartersFilled: boolean;
}

const GROUP_ORDER: Exclude<RosterSlotKey, "BN">[] = ["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "DST", "K"];
const LABEL: Partial<Record<RosterSlotKey, string>> = { DST: "D/ST", SUPERFLEX: "SFLEX" };

/**
 * Round at which an open slot turns urgent, from the prototype's 16-round thresholds,
 * scaled to the league's draft length.
 */
function urgentRound(key: RosterSlotKey, rounds: number): number {
  const base = key === "DST" || key === "K" ? 13 : key === "QB" || key === "TE" ? 8 : isFlexKey(key) ? 9 : 6;
  return Math.max(1, Math.round((base * rounds) / 16));
}

const isFlexKey = (key: RosterSlotKey) => key === "FLEX" || key === "SUPERFLEX";

/** Position needs for the needs strip, ported from the prototype's renderNeeds(). */
export function rosterNeeds(slots: FilledSlot[], round: number, rounds: number): RosterNeeds {
  const bench = slots.filter((s) => isBench(s.slot));
  const groups: NeedGroup[] = [];

  for (const key of GROUP_ORDER) {
    const group = slots.filter((s) => s.slot.key === key);
    if (!group.length) continue;
    const filled = group.map((s) => !!s.player);
    const isOpen = filled.some((f) => !f);
    const late = key === "DST" || key === "K";
    const flexWait =
      isFlexKey(key) &&
      group.some((g) =>
        slots.some((s) => !s.player && isDedicated(s.slot) && g.slot.eligible.includes(s.slot.eligible[0])),
      );
    const lateRound = round >= urgentRound(key, rounds);
    const soft = isOpen && ((late && !lateRound) || flexWait);
    const urgent = isOpen && lateRound && !flexWait;
    groups.push({
      key,
      label: LABEL[key] ?? key,
      filled,
      benchCount: isFlexKey(key) ? 0 : bench.filter((s) => s.player?.pos === key).length,
      open: isOpen && !soft,
      soft,
      urgent,
    });
  }

  return {
    groups,
    bench: { filled: bench.filter((s) => s.player).length, total: bench.length },
    need: groups.filter((g) => g.open).map((g) => g.label),
    urgentAny: groups.some((g) => g.urgent),
    allStartersFilled: slots.filter((s) => isStarterSlot(s.slot)).every((s) => s.player),
  };
}
