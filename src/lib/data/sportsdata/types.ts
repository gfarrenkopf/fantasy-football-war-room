/**
 * The subset of SportsDataIO's NFL response fields this pipeline reads.
 *
 * These are deliberately partial: the real responses carry 100+ fields per row
 * (see the committed fixtures). Only what normalization uses is typed, so a
 * change to an unrelated field can't break the build.
 *
 * Endpoint availability is tier-dependent. On the free trial, `Injuries` and
 * `scores/json/Players` return 401/404, which is why `note` is never populated
 * today — see docs/data-pipeline.md.
 */

/** `/v3/nfl/stats/json/FantasyPlayers` — the ADP and bye-week source. */
export interface SdFantasyPlayer {
  PlayerID: number;
  Name: string;
  Team: string | null;
  /** QB, RB, WR, TE, K, DEF. Note DEF, not DST. */
  Position: string;
  ByeWeek: number | null;
  /** Standard-scoring ADP. 0 or null when the player is undrafted. */
  AverageDraftPosition: number | null;
  /** Full-PPR ADP. */
  AverageDraftPositionPPR: number | null;
  /**
   * A raw season point total that ranks every QB above every skill player and
   * some kickers above starting RBs. Not used — see pipeline/ranks.ts.
   */
  ProjectedFantasyPoints: number | null;
}

/** `/v3/nfl/projections/json/PlayerSeasonProjectionStats/{season}` — the projection source. */
export interface SdSeasonProjection {
  PlayerID: number;
  Name: string;
  Team: string | null;
  FantasyPosition: string | null;
  /** Standard-scoring projected season points. */
  FantasyPoints: number | null;
  /** Full-PPR projected season points. The field this pipeline ranks on. */
  FantasyPointsPPR: number | null;
}

/** `/v3/nfl/scores/json/Byes/{season}` — authoritative bye weeks per team. */
export interface SdBye {
  Season: number;
  Week: number;
  Team: string;
}

/** One captured set of responses, whether fetched live or loaded from fixtures. */
export interface SdSnapshot {
  fantasyPlayers: SdFantasyPlayer[];
  projections: SdSeasonProjection[];
  byes: SdBye[];
}
