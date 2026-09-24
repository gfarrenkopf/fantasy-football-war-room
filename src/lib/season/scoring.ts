import type { Position } from "@/lib/draft/types";
import type { PlayerProjections, ScoringItem, StatLine } from "./types";

/**
 * League scoring applied to raw stats. ESPN's public projections are scored for its default PPR
 * league, but each row carries the raw stats, and Σ stat × points (with the slot override for the
 * player's position) reproduces a league's own `appliedTotal` exactly (docs/espn-protocol.md §8).
 */

/** ESPN's lineup slot id for each position: the key `pointsOverrides` uses. */
const SLOT_ID_OF: Readonly<Record<Position, string>> = { QB: "0", RB: "2", WR: "4", TE: "6", K: "17", DST: "16" };

/** Fantasy points for one stat line under a league's scoring. */
export function scoreStats(stats: StatLine, items: readonly ScoringItem[], pos: Position): number {
  const slot = SLOT_ID_OF[pos];
  let total = 0;
  for (const item of items) {
    const value = stats[String(item.statId)];
    if (typeof value !== "number") continue;
    total += value * (item.pointsOverrides?.[slot] ?? item.points);
  }
  return total;
}

/** A player's projected points by NFL week under a league's scoring. Weeks without a projection are left out. */
export function weeklyPoints(player: PlayerProjections, items: readonly ScoringItem[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const [week, stats] of player.weeks) out.set(week, scoreStats(stats, items, player.pos));
  return out;
}

/**
 * Rest-of-season points: the sum of weekly projections from `fromWeek` through `toWeek`, inclusive.
 * Bye weeks count as 0, because ESPN projects them as 0 (or not at all).
 */
export function restOfSeason(points: ReadonlyMap<number, number>, fromWeek: number, toWeek: number): number {
  let total = 0;
  for (let week = fromWeek; week <= toWeek; week++) total += points.get(week) ?? 0;
  return total;
}

/** Validates `mSettings.scoringSettings.scoringItems`, keeping well-formed items. */
export function parseScoringItems(raw: unknown): ScoringItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): ScoringItem[] => {
    const { statId, points, pointsOverrides } = (r ?? {}) as Partial<ScoringItem>;
    if (typeof statId !== "number" || typeof points !== "number") return [];
    const overrides =
      pointsOverrides && typeof pointsOverrides === "object"
        ? Object.fromEntries(Object.entries(pointsOverrides).filter(([, v]) => typeof v === "number"))
        : {};
    return [Object.keys(overrides).length ? { statId, points, pointsOverrides: overrides } : { statId, points }];
  });
}
