import "server-only";
import type { Db } from "@/lib/db/types";
import type { PlayerProjections } from "@/lib/season/types";
import { buildSeasonView, type SeasonView } from "@/lib/season/view";
import { getEspnProjections } from "./projections";
import { getEspnScoreboard } from "./scoreboard";
import { loadSeason, type SeasonLoad } from "./seasonData";

export type SeasonViewLoad =
  | { kind: "ok"; view: SeasonView; fetchedAt: Date; stale: boolean; projectionsMissing: boolean }
  | Exclude<SeasonLoad, { kind: "ok" }>;

/**
 * A league's season view (10.5): rosters from ESPN with the user's stored login, scored with ESPN's
 * projections. Shared by the season page and the in-season AI routes, so both see the same numbers.
 */
export async function loadSeasonView(db: Db, key: Buffer, userId: string, leagueId: string, { refresh = false }: { refresh?: boolean } = {}): Promise<SeasonViewLoad> {
  const load = await loadSeason(db, key, userId, leagueId, { refresh });
  if (load.kind !== "ok") return load;

  const { league: season } = load;
  const ids = season.teams.flatMap((t) => t.roster.map((e) => e.playerId));
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
  return { kind: "ok", view: buildSeasonView(season, load.espnTeamId, projections, games), fetchedAt: load.fetchedAt, stale: load.stale, projectionsMissing };
}
