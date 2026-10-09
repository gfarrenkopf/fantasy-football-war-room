import { optimalLineup, type LineupPlan } from "./lineup";
import type { GameState, Scoreboard } from "./scoreboard";
import { restOfSeason, weeklyPoints } from "./scoring";
import type { LineupSlot, LineupSlotCount, Matchup, MatchupResult, MatchupSide, PendingClaim, PendingTrade, PlayerProjections, RosterEntry, SeasonLeague, Standing } from "./types";

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
  standing: Standing | null;
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
  irSlots: number;
  myTeamId: number;
  teams: ViewTeam[];
  /** The user's lineup for this week. */
  lineup: LineupPlan;
  /** Trades pending on ESPN that involve the user's team. */
  pendingTrades: PendingTrade[];
  /** The league's trade deadline, as an ISO instant, and whether it had passed when ESPN was read. */
  tradeDeadline: string | null;
  tradeDeadlinePassed: boolean;
  /** The user's fantasy matchup this week, their side first; null on a bye or when ESPN didn't say. */
  matchup: { me: MatchupSide; them: MatchupSide } | null;
  /** Every fantasy matchup this week, the user's included (APE-307). */
  matchups: Matchup[];
  /** Every matchup ESPN has decided this season, for standings week by week. */
  results: MatchupResult[];
  /** The user's place in waivers (APE-212): their rank, and FAAB left when the league bids. */
  waiver: { rank: number | null; budget: number | null; left: number | null };
  /** The user's waiver claims pending on ESPN (13.4). */
  claims: ViewClaim[];
  /**
   * The moves War Room suggested that the user made this week (APE-256), each kept only while ESPN
   * still has the player in that slot.
   */
  warRoomMoves: WarRoomMove[];
}

/** A lineup move War Room suggested and the user made on ESPN: who, into which slot, and the projected points it gained then. */
export interface WarRoomMove {
  playerId: number;
  slot: LineupSlot;
  gain: number;
}

/** A pending claim, with the incoming player named from ESPN's projections feed. */
export interface ViewClaim extends Omit<PendingClaim, "add" | "teamId"> {
  add: { playerId: number; name: string; pos: PlayerProjections["pos"] | null; team: string | null };
}

/**
 * Whether a player is on a bye this week: ESPN projects him for nothing and his team has no game on
 * this week's scoreboard. ESPN also blanks the projection of a player it expects to sit while his
 * team still plays (APE-338); he has a game, so he isn't on a bye.
 */
export function onBye(p: Pick<ViewPlayer, "projected" | "points" | "team" | "game">): boolean {
  return p.projected && p.points === 0 && p.team !== null && p.game === null;
}

/**
 * Whether ESPN doesn't expect a player to play this week: it projects him for nothing although his
 * team has a game (APE-338). ESPN does this ahead of an official designation, so it isn't one.
 */
export function likelyOut(p: Pick<ViewPlayer, "projected" | "points" | "team" | "game">): boolean {
  return p.projected && p.points === 0 && p.team !== null && p.game !== null;
}

/** A roster entry scored for this league: weekly and rest-of-season projections, and his game. */
export function scorePlayer(
  league: Pick<SeasonLeague, "currentWeek" | "finalWeek" | "scoringItems">,
  entry: RosterEntry,
  proj: PlayerProjections | undefined,
  games: Scoreboard = new Map(),
): ViewPlayer {
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
}

export function buildSeasonView(
  league: SeasonLeague,
  myTeamId: number,
  projections: ReadonlyMap<number, PlayerProjections>,
  { games = new Map(), now = 0, moves = [] }: { games?: Scoreboard; now?: number; moves?: readonly WarRoomMove[] } = {},
): SeasonView {
  const toPlayer = (entry: RosterEntry) => scorePlayer(league, entry, projections.get(entry.playerId), games);
  // ESPN writes an outlook for nearly everyone each week, so only a day-old or newer story earns the tag. Outlooks run
  // to a paragraph each, so only the user's own players' are sent to the page.
  const fresh = (news: RosterEntry["news"]) => !!news?.at && now - Date.parse(news.at) < NEWS_FRESH_MS;
  const teams = league.teams.map((t) => ({
    id: t.id,
    name: t.name,
    abbrev: t.abbrev,
    standing: t.standing,
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
    irSlots: league.irSlots,
    myTeamId,
    teams,
    lineup: optimalLineup(mine, league.starters),
    pendingTrades: league.pendingTrades.filter((t) => t.proposerTeamId === myTeamId || t.partnerTeamId === myTeamId),
    tradeDeadline: league.tradeDeadline,
    tradeDeadlinePassed: !!league.tradeDeadline && now > Date.parse(league.tradeDeadline),
    matchup: myMatchup(league, myTeamId),
    matchups: league.matchups,
    results: league.results,
    waiver: myWaiver(league, myTeamId),
    warRoomMoves: moves.filter((m) => mine.some((p) => p.playerId === m.playerId && p.slot === m.slot)),
    claims: league.pendingClaims
      .filter((c) => c.teamId === myTeamId)
      .map(({ id, add, drop, bid, processesAt }) => {
        const proj = projections.get(add);
        return { id, drop, bid, processesAt, add: { playerId: add, name: proj?.name ?? `ESPN player ${add}`, pos: proj?.pos ?? null, team: proj?.team ?? null } };
      }),
  };
}

function myWaiver(league: SeasonLeague, myTeamId: number): SeasonView["waiver"] {
  const mine = league.waivers.teams.find((t) => t.teamId === myTeamId);
  const { budget } = league.waivers;
  return { rank: mine?.rank ?? null, budget, left: budget === null ? null : Math.max(0, budget - (mine?.spent ?? 0)) };
}

function myMatchup(league: SeasonLeague, myTeamId: number): SeasonView["matchup"] {
  for (const { home, away } of league.matchups) {
    if (!away) continue;
    if (home.teamId === myTeamId) return { me: home, them: away };
    if (away.teamId === myTeamId) return { me: away, them: home };
  }
  return null;
}

/** How recent ESPN's last news on a player must be for his outlook to show: a day. */
export const NEWS_FRESH_MS = 24 * 60 * 60 * 1000;

/** Projections to two decimals: finer than any screen shows, and a smaller page. */
const round = (n: number) => Math.round(n * 100) / 100;
