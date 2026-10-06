import type { Position } from "@/lib/draft/types";
import type { StatLine } from "./types";

/**
 * A player's game in a few words, the way ESPN's matchup screen puts it: "329 YDS, 2 TD" (APE-247).
 * Picks the stats that moved his fantasy points most in this league, using ESPN's own per-stat
 * points (`appliedStats` on his actual row), so tiers, bonuses and per-slot overrides are already in.
 * Stat ids are ESPN's, confirmed against live rows (docs/espn-protocol.md, "An actual row has the stats").
 */

/** How many stats a line shows at most, as ESPN does. */
export const STAT_LINE_MAX = 3;

interface Group {
  /** The ids whose points count toward this stat's impact: the stat, plus its every-N-yards and bonus ids. */
  points: readonly number[];
  text: (stats: StatLine) => string;
}

const total = (stats: StatLine, ids: readonly number[]) => ids.reduce((sum, id) => sum + (stats[id] ?? 0), 0);
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A count always shown with its number: "52 YDS", "4 REC", "17 PA". */
const amount = (label: string, counted: readonly number[], points: readonly number[] = counted): Group => ({
  points,
  text: (stats) => `${num(total(stats, counted))} ${label}`,
});
/** A count shown bare when it's one, like ESPN's "TD" and "2 TD". */
const tally = (label: string, counted: readonly number[], points: readonly number[] = counted): Group => ({
  points,
  text: (stats) => {
    const n = total(stats, counted);
    return n === 1 ? label : `${num(n)} ${label}`;
  },
});
/** Made over attempted: "2/3 FG". */
const made = (label: string, madeId: number, triedId: number, points: readonly number[]): Group => ({
  points,
  text: (stats) => `${num(stats[madeId] ?? 0)}/${num(stats[triedId] ?? 0)} ${label}`,
});

// Offense. Yards come with ESPN's every-5/10/20/25/50/100-yard ids and its big-game bonuses; TDs with
// their long-TD bonuses.
const PASS_YDS = [3, ...range(5, 10), 17, 18];
const PASS_TD = [4, 15, 16];
const RUSH_YDS = [24, ...range(27, 32), 37, 38];
const RUSH_TD = [25, 35, 36];
const REC_YDS = [42, ...range(47, 52), 56, 57];
const REC_TD = [43, 45, 46];
const REC = [53, 54, 55];
const INT = [20];
const FUM_LOST = [72];
const TWO_PT = [19, 26, 44];

const passYds = (label: string) => amount(label, [3], PASS_YDS);
const passTd = (label: string) => tally(label, [4], PASS_TD);
const shared = { int: tally("INT", INT), fum: tally("FUM", FUM_LOST), twoPt: tally("2PT", TWO_PT) };
/** A runner or catcher's yards and TDs, rushing and receiving together, as ESPN shows them. */
const scrimmage = { yds: amount("YDS", [24, 42], [...RUSH_YDS, ...REC_YDS]), td: tally("TD", [25, 43], [...RUSH_TD, ...REC_TD]), rec: amount("REC", [53], REC) };
const passing = [passYds("PASS YDS"), passTd("PASS TD"), shared.int];

/** Each position's stats in the order its line shows them; the first is what a quiet game falls back to. */
const ORDER: Readonly<Record<Position, readonly Group[]>> = {
  QB: [passYds("YDS"), passTd("TD"), shared.int, amount("RUSH YDS", [24], RUSH_YDS), tally("RUSH TD", [25], RUSH_TD), shared.fum, shared.twoPt],
  RB: [scrimmage.yds, scrimmage.td, scrimmage.rec, ...passing, shared.fum, shared.twoPt],
  WR: [scrimmage.rec, scrimmage.yds, scrimmage.td, ...passing, shared.fum, shared.twoPt],
  TE: [scrimmage.rec, scrimmage.yds, scrimmage.td, ...passing, shared.fum, shared.twoPt],
  // FG made by distance (74–82, 198–203), totals and misses (83–85); XP made, tried and missed (86–88).
  K: [made("FG", 83, 84, [...range(74, 85), ...range(198, 203)]), made("XP", 86, 87, [86, 87, 88])],
  // Points and yards allowed score by tier: 89–92 and 121–125 for points, 128–136 for yards.
  DST: [
    amount("PA", [120], [...range(89, 92), ...range(121, 125)]),
    amount("YA", [127], range(128, 136)),
    tally("SACK", [99]),
    tally("INT", [95]),
    tally("FR", [96]),
    tally("TD", [93, 94, ...range(101, 104)]),
    tally("BLK", [97]),
    tally("SFTY", [98]),
  ],
};

/**
 * The stats that moved a player's points most, biggest swing first by absolute points (an INT's −2
 * counts as much as +2), up to three, then shown in his position's order. A player who played but
 * scored nothing gets his position's main stat ("0 REC"). Null with no stats at all: his game hasn't
 * started, or he didn't play. Stats with no group here still count in his points; they just don't show.
 */
export function summarizeStats(pos: Position, stats: StatLine, applied: StatLine): string | null {
  if (!Object.keys(stats).length) return null;
  const order = ORDER[pos];
  const impact = order.map((group, i) => ({ i, swing: Math.abs(total(applied, group.points)) })).filter((g) => g.swing > 0.001);
  const shown = impact.length
    ? impact
        .sort((a, b) => b.swing - a.swing || a.i - b.i)
        .slice(0, STAT_LINE_MAX)
        .sort((a, b) => a.i - b.i)
        .map((g) => order[g.i])
    : [order[0]];
  return shown.map((group) => group.text(stats)).join(", ");
}
