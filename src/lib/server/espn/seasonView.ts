import "server-only";
import type { Db } from "@/lib/db/types";
import type { PlayerProjections } from "@/lib/season/types";
import { buildSeasonView, type SeasonView } from "@/lib/season/view";
import { gameDayPhase, matchupLive, type GameDayPhase } from "@/lib/season/gameday";
import { getEspnProjections } from "./projections";
import { getEspnScoreboard } from "./scoreboard";
import { loadSeason, type SeasonLoad } from "./seasonData";

/** While a game is under way the league is read at most this long ago, so a page refreshing each minute sees new points (APE-227). */
export const LIVE_MAX_AGE_MS = 45 * 1000;

export type SeasonViewLoad =
  | { kind: "ok"; view: SeasonView; fetchedAt: Date; stale: boolean; projectionsMissing: boolean; phase: GameDayPhase }
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
  // The scoreboard never fails: without it, live points show without a game status.
  const [projected, games] = await Promise.all([
    getEspnProjections({ season: season.season, playerIds: ids, fromWeek: season.currentWeek, toWeek: season.finalWeek, ...fresh }).catch((err: Error) => {
      console.warn(`[espn-season] projections unavailable: ${err.message}`);
      projectionsMissing = true;
      return projections;
    }),
    getEspnScoreboard({ season: season.season, week: season.currentWeek, ...fresh }),
  ]);
  projections = projected;
  let view = buildSeasonView(season, load.espnTeamId, projections, { games, now: load.fetchedAt.getTime() });
  // The cached league is minutes old, but games are on: read it again for the points scored since.
  if (!refresh && matchupLive(view) && Date.now() - load.fetchedAt.getTime() >= LIVE_MAX_AGE_MS) {
    const live = await loadSeason(db, key, userId, leagueId, { maxAgeMs: LIVE_MAX_AGE_MS });
    if (live.kind === "ok" && live.league.currentWeek === season.currentWeek) {
      load = live;
      view = buildSeasonView(live.league, live.espnTeamId, projections, { games, now: live.fetchedAt.getTime() });
    }
  }
  return { kind: "ok", view, fetchedAt: load.fetchedAt, stale: load.stale, projectionsMissing, phase: gameDayPhase(view, Date.now()) };
}
