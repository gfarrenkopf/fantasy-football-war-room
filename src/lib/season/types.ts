import type { Position, RosterSlotKey } from "@/lib/draft/types";

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

/** Where a rostered player sits: one of our starting slots, the bench, or ESPN's IR slot. */
export type LineupSlot = RosterSlotKey | "IR";

/** One player on a team's ESPN roster this week. */
export interface RosterEntry {
  playerId: number;
  name: string;
  pos: Position;
  /** NFL team abbreviation; null for a free agent. */
  team: string | null;
  slot: LineupSlot;
  /** ESPN's own lineup slot id for `slot`, which lineup writes need. */
  espnSlotId: number;
  /** The player's game has started this week: ESPN won't move them until next week. */
  locked: boolean;
  injuryStatus: InjuryStatus;
}

export interface SeasonTeam {
  id: number;
  name: string;
  abbrev: string;
  roster: RosterEntry[];
}

/** A starting slot of the league's lineup, and how many of it there are. */
export interface LineupSlotCount {
  key: Exclude<RosterSlotKey, "BN">;
  count: number;
}

/** An ESPN league as the in-season engine needs it, read from `mSettings`, `mStatus`, `mRoster` and `mTeam`. */
export interface SeasonLeague {
  espnLeagueId: string;
  season: number;
  name: string;
  /** The NFL week ESPN is on (its `scoringPeriodId`). */
  currentWeek: number;
  /** The last week the league plays, playoffs included. */
  finalWeek: number;
  /** The first week of the fantasy playoffs, or null when ESPN doesn't say. */
  playoffStartWeek: number | null;
  scoringItems: ScoringItem[];
  /** Starting slots, in lineup order. */
  starters: LineupSlotCount[];
  benchSize: number;
  teams: SeasonTeam[];
  /** Trades waiting on ESPN that the user can see: their own offers, in both directions. */
  pendingTrades: PendingTrade[];
}

/** A trade pending on ESPN (`mPendingTransactions`), between two teams. */
export interface PendingTrade {
  id: string;
  /** proposed: waiting on the other team. accepted: agreed, in the league's review period. */
  status: "proposed" | "accepted";
  proposerTeamId: number;
  /** The other team. */
  partnerTeamId: number;
  moves: { playerId: number; fromTeamId: number; toTeamId: number }[];
  /** ISO instants, when ESPN gave them. */
  proposedAt: string | null;
  expiresAt: string | null;
  processesAt: string | null;
}
