import type { Position } from "@/lib/draft/types";
import { optimalLineup } from "./lineup";
import type { LineupSlot, LineupSlotCount, MatchupResult, MatchupSide } from "./types";
import type { SeasonView, ViewPlayer } from "./view";

/**
 * A finished week as it's kept (APE-307, APE-308): every team's players with what they scored and
 * what ESPN projected, every matchup's score, and the standings after it. The recap is built from
 * these when the page shows it (leagueRecap.ts), so a section added later works on weeks kept before
 * it. Plain JSON, stored as is; `version` changes when the shape does.
 */

export const WEEK_FACTS_VERSION = 1;

export interface FactPlayer {
  playerId: number;
  name: string;
  pos: Position;
  team: string | null;
  slot: LineupSlot;
  /** Points scored, by this league's scoring; 0 for a player who didn't play. */
  points: number;
  /** ESPN's projection: its call before kickoff when War Room recorded one (the user's players), otherwise the week's. */
  projected: number;
  statLine: string | null;
}

export interface FactTeam {
  id: number;
  name: string;
  abbrev: string;
  /** Starters in lineup order, then the bench, then IR. */
  players: FactPlayer[];
}

export interface FactSide {
  teamId: number;
  points: number;
}

/** A team's record after the week; `rank` is its place by record, then points. */
export interface FactStanding {
  teamId: number;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface WeekFacts {
  version: typeof WEEK_FACTS_VERSION;
  season: number;
  week: number;
  /** The user's team, whose week the recap leads with. */
  myTeamId: number;
  /** The league's starting slots, in lineup order. */
  starters: LineupSlotCount[];
  teams: FactTeam[];
  /** The week's matchups, in ESPN's final numbers; `away` is null for a bye. */
  matchups: { home: FactSide; away: FactSide | null }[];
  standings: FactStanding[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The facts of a finished week from its view. `calls` are ESPN's pre-kickoff projections War Room
 * recorded for the user's players (season_projections), which beat the week's own numbers.
 */
export function toWeekFacts(view: SeasonView, calls: ReadonlyMap<number, number> = new Map()): WeekFacts {
  const order = new Map<LineupSlot, number>(view.starters.map((s, i) => [s.key, i]));
  const rank = (slot: LineupSlot) => order.get(slot) ?? (slot === "BN" ? order.size : order.size + 1);
  return {
    version: WEEK_FACTS_VERSION,
    season: view.season,
    week: view.currentWeek,
    myTeamId: view.myTeamId,
    starters: view.starters,
    teams: view.teams.map((t) => ({
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      players: [...t.roster]
        .sort((a, b) => rank(a.slot) - rank(b.slot))
        .map((p) => ({
          playerId: p.playerId,
          name: p.name,
          pos: p.pos,
          team: p.team,
          slot: p.slot,
          points: round(p.actual ?? 0),
          projected: round((t.id === view.myTeamId ? calls.get(p.playerId) : undefined) ?? p.points),
          statLine: p.statLine,
        })),
    })),
    matchups: view.matchups.map(({ home, away }) => ({
      home: { teamId: home.teamId, points: home.points },
      away: away && { teamId: away.teamId, points: away.points },
    })),
    standings: standingsAfter(
      view.results,
      view.currentWeek,
      view.teams.map((t) => t.id),
    ),
  };
}

/**
 * Each team's record over the matchups decided by the end of `week`, ranked by win share, then
 * points scored. A period spanning two weeks counts once both have been played.
 */
export function standingsAfter(results: readonly MatchupResult[], week: number, teamIds: readonly number[]): FactStanding[] {
  const rows = new Map(teamIds.map((teamId) => [teamId, { teamId, rank: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0 }]));
  for (const r of results) {
    if (Math.max(...r.weeks) > week || !r.away) continue;
    const home = rows.get(r.home.teamId);
    const away = rows.get(r.away.teamId);
    if (!home || !away) continue;
    home.pointsFor += r.home.points;
    away.pointsFor += r.away.points;
    if (r.winner === "tie") {
      home.ties++;
      away.ties++;
    } else {
      const [won, lost] = r.winner === "home" ? [home, away] : [away, home];
      won.wins++;
      lost.losses++;
    }
  }
  const share = (r: FactStanding) => {
    const games = r.wins + r.losses + r.ties;
    return games ? (r.wins + r.ties / 2) / games : 0;
  };
  return [...rows.values()]
    .sort((a, b) => share(b) - share(a) || b.pointsFor - a.pointsFor || a.teamId - b.teamId)
    .map((r, i) => ({ ...r, pointsFor: round(r.pointsFor), rank: i + 1 }));
}

/**
 * A kept week as a season view, as far as the facts go: every player at his points and projection,
 * the user's matchup, and nothing live. For the views that tell the user's week (weekRecap(),
 * weekSwing()), so an archived week is told the way game day told it.
 */
export function factsView(facts: WeekFacts): SeasonView {
  const toPlayer = (p: FactPlayer): ViewPlayer => ({
    playerId: p.playerId,
    name: p.name,
    pos: p.pos,
    team: p.team,
    slot: p.slot,
    espnSlotId: 0,
    locked: true,
    injuryStatus: "ACTIVE",
    actual: p.points,
    statLine: p.statLine,
    ownership: null,
    news: null,
    weekly: { [facts.week]: p.projected },
    points: p.projected,
    ros: p.projected,
    projected: true,
    game: null,
  });
  const teams = facts.teams.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, standing: null, roster: t.players.map(toPlayer) }));
  const projectedOf = (teamId: number) =>
    teams
      .find((t) => t.id === teamId)
      ?.roster.filter((p) => p.slot !== "BN" && p.slot !== "IR")
      .reduce((sum, p) => sum + p.points, 0) ?? 0;
  const side = (s: FactSide): MatchupSide => ({ teamId: s.teamId, points: s.points, projected: projectedOf(s.teamId), winProbability: null });
  const mine = facts.matchups.find((m) => m.away && (m.home.teamId === facts.myTeamId || m.away.teamId === facts.myTeamId));
  const matchups = facts.matchups.map((m) => ({ home: side(m.home), away: m.away && side(m.away) }));
  return {
    name: "",
    espnLeagueId: "",
    season: facts.season,
    currentWeek: facts.week,
    finalWeek: facts.week,
    playoffStartWeek: null,
    starters: facts.starters,
    benchSize: 0,
    irSlots: 0,
    myTeamId: facts.myTeamId,
    teams,
    lineup: optimalLineup(teams.find((t) => t.id === facts.myTeamId)?.roster ?? [], facts.starters),
    pendingTrades: [],
    tradeDeadline: null,
    tradeDeadlinePassed: false,
    matchup: mine?.away
      ? mine.home.teamId === facts.myTeamId
        ? { me: side(mine.home), them: side(mine.away) }
        : { me: side(mine.away), them: side(mine.home) }
      : null,
    matchups,
    results: [],
    waiver: { rank: null, budget: null, left: null },
    claims: [],
    warRoomMoves: [],
  };
}
