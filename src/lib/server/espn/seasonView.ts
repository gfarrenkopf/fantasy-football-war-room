import "server-only";
import type { Db } from "@/lib/db/types";
import type { PlayerProjections, SeasonLeague } from "@/lib/season/types";
import { buildSeasonView, type SeasonView } from "@/lib/season/view";
import { gameDayPhase, inResultHold, matchupDecided, matchupLive, type GameDayPhase } from "@/lib/season/gameday";
import { listLineupMoves } from "../lineupMoves";
import { getEspnProjections } from "./projections";
import { getEspnScoreboard } from "./scoreboard";
import { loadSeason, type SeasonLoad } from "./seasonData";

/** While a game is under way the league is read at most this long ago, so a page refreshing each minute sees new points (APE-227). */
export const LIVE_MAX_AGE_MS = 45 * 1000;

/** A finished week barely changes (stat corrections), so last week's read is kept longer. */
const RESULT_MAX_AGE_MS = 15 * 60 * 1000;

export type SeasonViewLoad =
  | {
      kind: "ok";
      view: SeasonView;
      /** Last week, when ESPN has moved on but its result is still up (APE-251); game day shows it instead of `view`. */
      result?: SeasonView;
      /** Last week once its result has come down, for the recap game day keeps between weeks (APE-306). */
      previous?: SeasonView;
      fetchedAt: Date;
      stale: boolean;
      projectionsMissing: boolean;
      phase: GameDayPhase;
    }
  | Exclude<SeasonLoad, { kind: "ok" }>;

/**
 * A league's season view (10.5): rosters from ESPN with the user's stored login, scored with ESPN's
 * projections. Shared by the season page and the in-season AI routes, so both see the same numbers.
 */
export async function loadSeasonView(db: Db, key: Buffer, userId: string, leagueId: string, { refresh = false }: { refresh?: boolean } = {}): Promise<SeasonViewLoad> {
  let load = await loadSeason(db, key, userId, leagueId, { refresh });
  if (load.kind !== "ok") return load;

  const { league: season } = load;
  // Claimed players aren't on a roster, but the page names them.
  const ids = [...season.teams.flatMap((t) => t.roster.map((e) => e.playerId)), ...season.pendingClaims.map((c) => c.add)];
  // Only the projections fetch is allowed to fail: without it every player shows 0, with a note.
  let projections = new Map<number, PlayerProjections>();
  let projectionsMissing = false;
  const fresh = refresh ? { maxAgeMs: 0 } : {};
  // The scoreboard never fails: without it, live points show without a game status. Nor do War
  // Room's moves (APE-256): without them the lineup just doesn't mark them.
  const [projected, games, moves] = await Promise.all([
    getEspnProjections({ season: season.season, playerIds: ids, fromWeek: season.currentWeek, toWeek: season.finalWeek, ...fresh }).catch((err: Error) => {
      console.warn(`[espn-season] projections unavailable: ${err.message}`);
      projectionsMissing = true;
      return projections;
    }),
    getEspnScoreboard({ season: season.season, week: season.currentWeek, ...fresh }),
    listLineupMoves(db, leagueId, season.season, season.currentWeek).catch((err: Error) => {
      console.warn(`[espn-season] Draft Room's moves unavailable: ${err.message}`);
      return [];
    }),
  ]);
  projections = projected;
  let view = buildSeasonView(season, load.espnTeamId, projections, { games, now: load.fetchedAt.getTime(), moves });
  // The cached league is minutes old, but games are on: read it again for the points scored since.
  if (!refresh && matchupLive(view) && Date.now() - load.fetchedAt.getTime() >= LIVE_MAX_AGE_MS) {
    const live = await loadSeason(db, key, userId, leagueId, { maxAgeMs: LIVE_MAX_AGE_MS });
    if (live.kind === "ok" && live.league.currentWeek === season.currentWeek) {
      load = live;
      view = buildSeasonView(live.league, live.espnTeamId, projections, { games, now: live.fetchedAt.getTime(), moves });
    }
  }
  const now = Date.now();
  const phase = gameDayPhase(view, now);
  const base = { kind: "ok" as const, view, fetchedAt: load.fetchedAt, stale: load.stale, projectionsMissing };
  if (phase !== "lineup") return { ...base, phase };
  const last = await lastWeek(db, key, userId, leagueId, season);
  if (last && inResultHold(now) && gameDayPhase(last, now) === "results") return { ...base, result: last, phase: "results" };
  return last && matchupDecided(last) ? { ...base, previous: last, phase } : { ...base, phase };
}

/**
 * Last week's view. ESPN moves to the next week early Tuesday, but the week's result stays up until
 * Wednesday morning (APE-251), and its recap for the rest of the week (APE-306). Null in week 1, and
 * when any of its reads fails, so the page goes on without it.
 */
async function lastWeek(db: Db, key: Buffer, userId: string, leagueId: string, current: SeasonLeague): Promise<SeasonView | null> {
  const week = current.currentWeek - 1;
  if (week < 1) return null;
  try {
    return await loadWeekView(db, key, userId, leagueId, week);
  } catch (err) {
    console.warn(`[espn-season] last week's result unavailable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * A past week's view, as ESPN has it now: rosters and points for that week, scored with its
 * projections (APE-308). Null when the league can't be read or ESPN doesn't have the week; throws
 * when the projections or scoreboard reads fail.
 */
export async function loadWeekView(db: Db, key: Buffer, userId: string, leagueId: string, week: number, { maxAgeMs = RESULT_MAX_AGE_MS }: { maxAgeMs?: number } = {}): Promise<SeasonView | null> {
  const load = await loadSeason(db, key, userId, leagueId, { week, maxAgeMs });
  if (load.kind !== "ok" || load.league.currentWeek !== week) return null;
  const ids = load.league.teams.flatMap((t) => t.roster.map((e) => e.playerId));
  const [projections, games] = await Promise.all([
    getEspnProjections({ season: load.league.season, playerIds: ids, fromWeek: week, toWeek: week }),
    getEspnScoreboard({ season: load.league.season, week }),
  ]);
  return buildSeasonView(load.league, load.espnTeamId, projections, { games, now: load.fetchedAt.getTime() });
}
