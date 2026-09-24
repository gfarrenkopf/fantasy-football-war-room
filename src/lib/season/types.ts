import type { Position } from "@/lib/draft/types";

/**
 * The in-season vocabulary (Epic 10, docs/in-season.md). In-season players are ESPN's, keyed by
 * ESPN player id: rosters come from ESPN and run hundreds deep, far past the draft dataset, so
 * there's no crosswalk to the war room's own player ids here.
 */

/** One week's or one season's raw stat totals, keyed by ESPN stat id ("53" is receptions). */
export type StatLine = Readonly<Record<string, number>>;

/** One line of a league's scoring (`mSettings.scoringSettings.scoringItems`). */
export interface ScoringItem {
  statId: number;
  points: number;
  /** Points by ESPN lineup slot id, replacing `points` for players at that position (D/ST points-allowed tiers under "16"). */
  pointsOverrides?: Readonly<Record<string, number>>;
}

/**
 * ESPN's injury designation. The values seen so far are ACTIVE, NORMAL, QUESTIONABLE, DOUBTFUL,
 * OUT, INJURY_RESERVE and SUSPENSION; anything else passes through as-is.
 */
export type InjuryStatus = string;

/** A player's projected raw stats for each NFL week, league-agnostic until scored. */
export interface PlayerProjections {
  id: number;
  name: string;
  pos: Position;
  /** NFL team abbreviation; null for a free agent. */
  team: string | null;
  injuryStatus: InjuryStatus;
  /** Projected raw stats by NFL week (ESPN's scoringPeriodId). A week with no row isn't projected. */
  weeks: ReadonlyMap<number, StatLine>;
}
