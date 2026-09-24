/**
 * How loudly the season page announces a projected gain (or loss). The page escalates the way the
 * draft room does as a pick approaches: at rest when there's nothing to gain, and committing
 * completely, green and breathing, when a lot is on the table.
 */

export type Emphasis = "rest" | "trim" | "gain" | "swing" | "must";

/** Points a week, at or above which each level starts. */
const LINEUP_STEPS: readonly [Emphasis, number][] = [
  ["must", 10],
  ["swing", 5],
  ["gain", 1],
  ["trim", 0.05],
];

/** A trade is judged per remaining week, where a point or two is already a lot. */
const TRADE_STEPS: readonly [Emphasis, number][] = [
  ["must", 5],
  ["swing", 2],
  ["gain", 0.5],
  ["trim", 0.05],
];

function level(points: number, steps: readonly [Emphasis, number][]): Emphasis {
  const size = Math.abs(points);
  return steps.find(([, from]) => size >= from)?.[0] ?? "rest";
}

/** A lineup change is always a gain (the recommendation never projects less). */
export const lineupEmphasis = (gain: number): Emphasis => level(gain, LINEUP_STEPS);

/** A trade can cost as well as gain; the sign says which way the page leans. */
export const tradeEmphasis = (perWeek: number): Emphasis => level(perWeek, TRADE_STEPS);
