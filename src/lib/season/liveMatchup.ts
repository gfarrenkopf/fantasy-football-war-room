/**
 * The user's matchup as Game day's scoreboard shows it (APE-379): the `live` sub-object of the
 * season response, and the content state of the Game day Live Activity (21.5), so the app and the
 * activity decode the same thing. Built by liveMatchup() in src/lib/server/v1/season.ts.
 */

export interface LiveSide {
  teamId: number;
  name: string;
  points: number;
  projected: number;
  /** Starters still to finish. */
  left: number;
}

export interface LiveMatchup {
  week: number;
  /** "Live", "Final", "3 left for Opponent", "5 to play" or "Up next". */
  status: string;
  /** A game on either side is under way. */
  live: boolean;
  /** A starter on either side has kicked off; before then, show the projections. */
  started: boolean;
  decided: boolean;
  /** The user's points less their opponent's. */
  lead: number;
  /** ESPN's chance the user wins, as a whole percent; null when ESPN didn't say. */
  win: number | null;
  me: LiveSide;
  them: LiveSide;
}
