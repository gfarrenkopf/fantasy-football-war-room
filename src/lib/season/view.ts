import { optimalLineup, type LineupPlan } from "./lineup";
import type { GameState, Scoreboard } from "./scoreboard";
import { restOfSeason, weeklyPoints } from "./scoring";
import type { LineupSlotCount, PendingTrade, PlayerProjections, RosterEntry, SeasonLeague } from "./types";

/**
 * Everything the season page shows, computed on the server from ESPN's league and projections and
 * handed to the client as plain JSON (10.5). Weekly points are scored for this league; the trade
 * engine (10.6) works from the same numbers in the browser.
 */

export interface ViewPlayer extends RosterEntry {
  /** Projected points by NFL week, from this week through the league's last. Missing weeks are 0. */
  weekly: Record<number, number>;
  /** Projected points this week. */
  points: number;
  /** Rest of season: this week through the league's last. */
  ros: number;
  /** Whether ESPN projected the player at all. An unprojected player shows as 0, with a note. */
  projected: boolean;
  /** His NFL game this week, or null for a bye, a free agent, or a scoreboard that didn't load. */
  game: GameState | null;
}

export interface ViewTeam {
  id: number;
  name: string;
  abbrev: string;
  roster: ViewPlayer[];
}

export interface SeasonView {
  name: string;
  espnLeagueId: string;
  season: number;
  currentWeek: number;
  finalWeek: number;
  playoffStartWeek: number | null;
  starters: LineupSlotCount[];
  benchSize: number;
  myTeamId: number;
  teams: ViewTeam[];
  /** The user's lineup for this week. */
  lineup: LineupPlan;
  /** Trades pending on ESPN that involve the user's team. */
  pendingTrades: PendingTrade[];
}

export function buildSeasonView(
  league: SeasonLeague,
  myTeamId: number,
  projections: ReadonlyMap<number, PlayerProjections>,
  { games = new Map(), now = 0 }: { games?: Scoreboard; now?: number } = {},
): SeasonView {
  const toPlayer = (entry: RosterEntry): ViewPlayer => {
    const proj = projections.get(entry.playerId);
    const scored = proj ? weeklyPoints(proj, league.scoringItems) : new Map<number, number>();
    const weekly: Record<number, number> = {};
    for (let week = league.currentWeek; week <= league.finalWeek; week++) weekly[week] = round(scored.get(week) ?? 0);
    return {
      ...entry,
      // ESPN's player feed can be fresher than the roster's on injuries.
      injuryStatus: proj?.injuryStatus ?? entry.injuryStatus,
      weekly,
      points: weekly[league.currentWeek] ?? 0,
      ros: round(restOfSeason(scored, league.currentWeek, league.finalWeek)),
      projected: !!proj,
      game: (entry.team && games.get(entry.team)) || null,
    };
  };
  // ESPN writes an outlook for nearly everyone each week, so only a day-old or newer story earns the tag. Outlooks run
  // to a paragraph each, so only the user's own players' are sent to the page.
  const fresh = (news: RosterEntry["news"]) => !!news?.at && now - Date.parse(news.at) < NEWS_FRESH_MS;
  const teams = league.teams.map((t) => ({
    id: t.id,
    name: t.name,
    abbrev: t.abbrev,
    roster: t.roster.map((entry) => toPlayer(t.id === myTeamId && fresh(entry.news) ? entry : { ...entry, news: null })),
  }));
  const mine = teams.find((t) => t.id === myTeamId)?.roster ?? [];
  return {
    name: league.name,
    espnLeagueId: league.espnLeagueId,
    season: league.season,
    currentWeek: league.currentWeek,
    finalWeek: league.finalWeek,
    playoffStartWeek: league.playoffStartWeek,
    starters: league.starters,
    benchSize: league.benchSize,
    myTeamId,
    teams,
    lineup: optimalLineup(mine, league.starters),
    pendingTrades: league.pendingTrades.filter((t) => t.proposerTeamId === myTeamId || t.partnerTeamId === myTeamId),
  };
}

/** How recent ESPN's last news on a player must be for his outlook to show: a day. */
export const NEWS_FRESH_MS = 24 * 60 * 60 * 1000;

/** Projections to two decimals: finer than any screen shows, and a smaller page. */
const round = (n: number) => Math.round(n * 100) / 100;
