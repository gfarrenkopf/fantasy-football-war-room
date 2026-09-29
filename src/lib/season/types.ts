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
  /**
   * Points scored this week so far, by this league's scoring: ESPN's actual row for the current
   * week. Null until the player's game starts.
   */
  actual: number | null;
  /** Share of ESPN leagues that roster and start him, 0–100; null when ESPN didn't say. */
  ownership: { owned: number; started: number } | null;
  /** ESPN's outlook for him this week, and when ESPN last had news on him; null with no outlook. */
  news: { note: string; at: string | null } | null;
}

/** A team's place in the league (`mTeam`): its overall record and ESPN's current playoff seed. */
export interface Standing {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** 1 is first; null when ESPN doesn't say. */
  seed: number | null;
}

export interface SeasonTeam {
  id: number;
  name: string;
  abbrev: string;
  roster: RosterEntry[];
  standing: Standing | null;
}

/** A starting slot of the league's lineup, and how many of it there are. */
export interface LineupSlotCount {
  key: Exclude<RosterSlotKey, "BN">;
  count: number;
}

/** One team's side of a fantasy matchup this week (`mMatchupScore`), in ESPN's own numbers. */
export interface MatchupSide {
  teamId: number;
  /** Points scored so far this matchup period. */
  points: number;
  /** ESPN's projection for the team's lineup as set on ESPN, live-adjusted once games start. */
  projected: number;
  /** ESPN's win probability, 0–1; null when ESPN doesn't give one. */
  winProbability: number | null;
}

/** A fantasy matchup in the current matchup period; `away` is null for a bye. */
export interface Matchup {
  home: MatchupSide;
  away: MatchupSide | null;
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
  /** The league's trade deadline (`tradeSettings.deadlineDate`), as an ISO instant; null for none. */
  tradeDeadline: string | null;
  /** This matchup period's fantasy matchups (APE-211). Empty when ESPN sent no schedule. */
  matchups: Matchup[];
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
