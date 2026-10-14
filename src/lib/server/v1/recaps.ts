import { archiveWeek, asWeekRecap, type LeagueRecap } from "@/lib/season/leagueRecap";
import type { WeekRecap } from "@/lib/season/recap";
import type { WeekSwing } from "@/lib/season/swing";
import type { KeptWeek } from "../seasonRecaps";

/**
 * GET /api/v1/leagues/:id/recaps and /recaps/:week (APE-383): the recap archive the season page's
 * Game day shows whenever no game is on (RecapArchive.tsx), for the iPhone app. Every value comes
 * from the same functions the web uses (archiveWeek(), asWeekRecap()).
 *
 * These interfaces are the contract the app's Codable types copy. Fields may be added, never
 * removed or renamed: a breaking change is /api/v2 (docs/ios.md).
 */

/** The user's result in a kept week, as the archive's week chips show it. */
export interface RecapResult {
  result: "win" | "loss" | "tie";
  me: number;
  them: number;
  opponent: string;
}

/** A kept week as the archive lists it. */
export interface RecapSummary {
  season: number;
  week: number;
  /** The week in a line: the story's first line, or "Bye week". */
  headline: string;
  /** Null for a bye, or when ESPN didn't list the user's matchup. */
  mine: RecapResult | null;
  /** When the week was kept, as an ISO instant: the Wednesday ESPN's stat corrections settled it, or its last save before then. */
  date: string;
  /** Whether ESPN's stat corrections are in; until then the numbers may still move. */
  settled: boolean;
}

export interface RecapsResponse {
  league: { id: string; name: string };
  /** Seasons with a kept week, newest first; the app shows a season picker once there are two. */
  seasons: number[];
  /** Every kept week, newest first. */
  weeks: RecapSummary[];
}

export interface RecapResponse extends RecapSummary {
  league: { id: string; name: string };
  /** The week as RecapArchive.tsx tells it: the user's result and story, standings, top scorers, game changer, benchwarmers and false starters. */
  recap: LeagueRecap;
  /** How the user's matchup swung (WeekSwing.tsx); null without one. */
  swing: WeekSwing | null;
  /** What the recap card draws (recapCard.ts), for the app's own card; null without a matchup. The card's league line is `league.name`. */
  card: WeekRecap | null;
}

function summary(kept: KeptWeek, recap: LeagueRecap): RecapSummary {
  const { mine } = recap;
  return {
    season: kept.facts.season,
    week: kept.facts.week,
    headline: recap.headline,
    mine: mine && { result: mine.result, me: mine.me, them: mine.them, opponent: mine.opponent },
    date: (kept.settledAt ?? kept.savedAt).toISOString(),
    settled: kept.settledAt !== null,
  };
}

export function recapsResponse(league: { id: string; name: string }, kept: readonly KeptWeek[]): RecapsResponse {
  const weeks = kept.map((k) => summary(k, archiveWeek(k.facts).recap)).sort((a, b) => b.season - a.season || b.week - a.week);
  return { league, seasons: [...new Set(weeks.map((w) => w.season))], weeks };
}

export function recapResponse(league: { id: string; name: string }, kept: KeptWeek): RecapResponse {
  const { recap, swing } = archiveWeek(kept.facts);
  return { league, ...summary(kept, recap), recap, swing, card: asWeekRecap(recap.week, recap.mine) };
}
