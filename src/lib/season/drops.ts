import { SLOT_DEFS } from "@/lib/draft/league";
import type { Position } from "@/lib/draft/types";
import { optimalLineup } from "./lineup";
import type { LineupSlotCount } from "./types";
import type { ViewPlayer } from "./view";

/**
 * Who to cut to make room on a roster (APE-348), wherever Draft Room suggests a drop: a waiver
 * pickup, a trade verdict, a trade idea, or a fill for a lineup hole.
 *
 * - A position never drops below its own starting slots: a team's only TE stays, however little he
 *   projects. FLEX and SUPERFLEX don't count as a position's own.
 * - A deeper position gives up a player first: rest-of-season value is discounted for each player a
 *   position carries beyond its own slots, so a team's fifth RB goes before a backup QB worth a little
 *   more, but not before one worth far more.
 * - No cut may leave this week's or next week's best lineup with a hole it wouldn't otherwise have:
 *   the backup TE stays the week before the starter's bye.
 *
 * When nobody passes, the last rule gives way first, then the first: the roster has to fit.
 */

export interface DropLeague {
  starters: readonly LineupSlotCount[];
  currentWeek: number;
  finalWeek: number;
}

/** How much each extra player beyond a position's own slots discounts his value as a keeper. */
const DEPTH_DISCOUNT = 0.25;

/** A position's own starting slots: QB for QBs, D/ST for D/STs. */
const ownSlots = (starters: readonly LineupSlotCount[], pos: Position) => starters.find((s) => s.key === pos)?.count ?? 0;

/** Every starting slot `pos` can play: its own, and the flex slots that take it. */
const slotsFor = (starters: readonly LineupSlotCount[], pos: Position) =>
  starters.reduce((n, s) => n + (SLOT_DEFS.find((d) => d.key === s.key)?.eligible.includes(pos) ? s.count : 0), 0);

/** Starting slots filled with nobody, or with a player projecting nothing, in `week`'s best lineup. */
function holes(roster: readonly ViewPlayer[], league: DropLeague, week: number): number {
  const candidates = roster.map((p) => ({ playerId: p.playerId, pos: p.pos, slot: "BN" as const, locked: false, injuryStatus: "ACTIVE", points: p.weekly[week] ?? 0 }));
  return optimalLineup(candidates, league.starters).starters.filter((s) => s.playerId === null || s.points <= 0).length;
}

/**
 * The players to cut, `count` of them, from `roster` (IR doesn't count against it and is never cut).
 * `keep` are never cut: the player coming in, a starter the caller won't drop. `droppable` narrows
 * who may go, as ESPN does once a player's game has started.
 */
export function pickDrops(
  roster: readonly ViewPlayer[],
  count: number,
  league: DropLeague,
  { keep = new Set<number>(), droppable = () => true }: { keep?: ReadonlySet<number>; droppable?: (p: ViewPlayer) => boolean } = {},
): number[] {
  const drops: number[] = [];
  let left = roster.filter((p) => p.slot !== "IR");
  const weeks = [league.currentWeek, league.currentWeek + 1].filter((w) => w <= league.finalWeek);
  for (let n = 0; n < count; n++) {
    const depth = (pos: Position) => left.filter((p) => p.pos === pos).length - ownSlots(league.starters, pos);
    const candidates = left
      .filter((p) => !keep.has(p.playerId) && droppable(p))
      .map((p) => ({ p, depth: depth(p.pos), value: p.ros / (1 + DEPTH_DISCOUNT * Math.max(0, depth(p.pos) - 1)) }))
      .sort((a, b) => a.value - b.value || b.depth - a.depth || a.p.playerId - b.p.playerId);
    if (!candidates.length) break;
    // Lineup solves are what this costs (trade ideas cut thousands of rosters), so they're skipped
    // whenever enough others at his position play that week to fill every slot he could.
    const before = new Map<number, number>();
    const opensHole = (p: ViewPlayer) => {
      const rest = left.filter((x) => x.playerId !== p.playerId);
      return weeks.some((w) => {
        if (rest.filter((x) => x.pos === p.pos && (x.weekly[w] ?? 0) > 0).length >= slotsFor(league.starters, p.pos)) return false;
        if (!before.has(w)) before.set(w, holes(left, league, w));
        return holes(rest, league, w) > before.get(w)!;
      });
    };
    const pick =
      candidates.find((c) => c.depth > 0 && !opensHole(c.p)) ?? // every rule
      candidates.find((c) => c.depth > 0) ?? // a hole next week before a position emptied
      candidates[0];
    drops.push(pick.p.playerId);
    left = left.filter((p) => p.playerId !== pick.p.playerId);
  }
  return drops;
}
