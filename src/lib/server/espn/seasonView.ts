import "server-only";
import type { Db } from "@/lib/db/types";
import type { PlayerProjections } from "@/lib/season/types";
import { buildSeasonView, type SeasonView } from "@/lib/season/view";
import { getEspnProjections } from "./projections";
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
  try {
    projections = await getEspnProjections({ season: season.season, playerIds: ids, fromWeek: season.currentWeek, toWeek: season.finalWeek, ...(refresh ? { maxAgeMs: 0 } : {}) });
  } catch (err) {
    console.warn(`[espn-season] projections unavailable: ${(err as Error).message}`);
    projectionsMissing = true;
  }
  return { kind: "ok", view: buildSeasonView(season, load.espnTeamId, projections), fetchedAt: load.fetchedAt, stale: load.stale, projectionsMissing };
}
