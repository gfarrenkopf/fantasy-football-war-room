import "server-only";
import type { Db } from "@/lib/db/types";
import { parseFreeAgents } from "@/lib/season/espnLeague";
import type { FreeAgent } from "@/lib/season/types";
import { scorePlayer, type SeasonView } from "@/lib/season/view";
import { rankPickups, type Pickup } from "@/lib/season/waivers";
import { readEspnLeague } from "./leagueReader";
import { loadLogin } from "./logins";
import { getEspnProjections } from "./projections";
import { getEspnScoreboard } from "./scoreboard";
import { loadSeason } from "./seasonData";
import { loadSeasonView } from "./seasonView";
import { confirmSignedOut } from "./sessionCheck";

/**
 * The waiver wire (APE-212): the league's most-rostered available players, read from ESPN with the
 * user's login, projected with the same public projections as rosters, and ranked by what they'd
 * add to the user's best lineup (src/lib/season/waivers.ts). Read when the user opens the tab, not
 * with the page, and cached for ten minutes: the pool only changes when someone adds or drops.
 */

/** How many available players to consider: the most-rostered across ESPN, the ones worth a claim. */
const POOL_SIZE = 100;
/** ESPN's slot ids for the positions War Room plays: QB, RB, WR, TE, D/ST, K. */
const POSITIONS = [0, 2, 4, 6, 16, 17];

/** ESPN's filter for the pool; only this week's projection row, since projections come from the public view. */
export const freeAgentFilter = (season: number, week: number) => ({
  players: {
    filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
    filterSlotIds: { value: POSITIONS },
    limit: POOL_SIZE,
    sortPercOwned: { sortAsc: false, sortPriority: 1 },
    filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: [`11${season}${week}`] },
  },
});

export type WaiverLoad =
  | { kind: "ok"; view: SeasonView; pickups: Pickup[]; considered: number; fetchedAt: Date }
  | { kind: "problem"; problem: "not-linked" | "no-login" | "disconnected" | "unavailable" | "invalid" };

type Cache = Map<string, { agents: FreeAgent[]; fetchedAt: number }>;
const TTL_MS = 10 * 60 * 1000;
const g = globalThis as { __espnWaiverCache?: Cache };

/** Drops the cached pool for a league, after the user has added a player from it. */
export function forgetWaivers(userId: string, leagueId: string) {
  for (const key of g.__espnWaiverCache?.keys() ?? []) if (key.startsWith(`${userId}:${leagueId}:`)) g.__espnWaiverCache!.delete(key);
}

export async function loadWaivers(db: Db, key: Buffer, userId: string, leagueId: string, { refresh = false }: { refresh?: boolean } = {}): Promise<WaiverLoad> {
  // The view first: it reads ESPN when the cache is cold, and the league read after it is then a hit.
  const viewLoad = await loadSeasonView(db, key, userId, leagueId);
  if (viewLoad.kind !== "ok") return { kind: "problem", problem: viewLoad.kind };
  const season = await loadSeason(db, key, userId, leagueId);
  if (season.kind !== "ok") return { kind: "problem", problem: season.kind };
  const { league } = season;
  const { view } = viewLoad;

  const cache: Cache = (g.__espnWaiverCache ??= new Map());
  const cacheKey = `${userId}:${leagueId}:${league.espnLeagueId}:${league.season}:${league.currentWeek}`;
  let hit = cache.get(cacheKey);
  if (!hit || refresh || Date.now() - hit.fetchedAt >= TTL_MS) {
    const login = await loadLogin(db, key, userId);
    if (!login) return { kind: "problem", problem: "no-login" };
    const read = await readEspnLeague(login, {
      season: league.season,
      espnLeagueId: league.espnLeagueId,
      views: ["kona_player_info"],
      scoringPeriodId: league.currentWeek,
      filter: freeAgentFilter(league.season, league.currentWeek),
    });
    if (!read.ok) {
      if (read.reason === "auth" && (await confirmSignedOut(db, userId, login, league))) return { kind: "problem", problem: "disconnected" };
      console.warn(`[espn-season] free agents unavailable: ${read.detail}`);
      if (!hit) return { kind: "problem", problem: "unavailable" };
    } else {
      hit = { agents: parseFreeAgents(read.data), fetchedAt: Date.now() };
      cache.set(cacheKey, hit);
    }
  }

  const agents = hit.agents;
  const [projections, games] = await Promise.all([
    getEspnProjections({ season: league.season, playerIds: agents.map((a) => a.playerId), fromWeek: league.currentWeek, toWeek: league.finalWeek }),
    getEspnScoreboard({ season: league.season, week: league.currentWeek }),
  ]);
  const pool = agents.map((a) => ({
    ...scorePlayer(
      league,
      { ...a, slot: "BN" as const, espnSlotId: 20, locked: false, actual: null, statLine: null, news: null },
      projections.get(a.playerId),
      games,
    ),
    status: a.status,
    waiverClears: a.waiverClears,
  }));
  return { kind: "ok", view, pickups: rankPickups(view, pool), considered: pool.length, fetchedAt: new Date(hit.fetchedAt) };
}
