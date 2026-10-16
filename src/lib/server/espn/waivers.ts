import "server-only";
import type { Db } from "@/lib/db/types";
import { SLOT_DEFS } from "@/lib/draft/league";
import type { Position } from "@/lib/draft/types";
import { parseFreeAgents } from "@/lib/season/espnLeague";
import { findHoles, rankFills, type Hole, type HoleFills, type PoolPlayer } from "@/lib/season/holes";
import { nextWeekHoles, rankAhead, type AheadFill, type WeekHole } from "@/lib/season/holesAhead";
import type { FreeAgent } from "@/lib/season/types";
import { scorePlayer, type SeasonView } from "@/lib/season/view";
import { rankPickups, valuePickup, type Pickup } from "@/lib/season/waivers";
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
 * with the page, and cached for ten minutes: the pool only changes when someone adds or drops. The
 * same pool, narrowed to a position, fills the holes in this week's lineup (APE-349).
 */

/** How many available players to consider: the most-rostered across ESPN, the ones worth a claim. */
const POOL_SIZE = 100;
/** For a hole, the most-rostered at the positions that can fill it: deep enough to reach a streamer. */
const FILL_POOL_SIZE = 50;
/** ESPN's slot id for each position War Room plays. */
const POSITION_SLOT: Record<Position, number> = { QB: 0, RB: 2, WR: 4, TE: 6, DST: 16, K: 17 };
const POSITIONS = Object.values(POSITION_SLOT);

/** A page of search or browse results (APE-409). */
export const SEARCH_PAGE = 25;

/** What a search narrows the pool by: a name ESPN matches by prefix on any word, and how far down the pool to start. */
type Narrow = { name?: string; offset?: number };

/**
 * ESPN's filter for the pool; only this week's projection row, since projections come from the
 * public view. `name` and `offset` search and page it (docs/espn-protocol.md §8, APE-408).
 */
export const freeAgentFilter = (season: number, week: number, positions: readonly number[] = POSITIONS, limit = POOL_SIZE, { name, offset }: Narrow = {}) => ({
  players: {
    filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
    filterSlotIds: { value: positions },
    ...(name ? { filterName: { value: name } } : {}),
    limit,
    ...(offset ? { offset } : {}),
    sortPercOwned: { sortAsc: false, sortPriority: 1 },
    filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: [`11${season}${week}`] },
  },
});

type Problem = "not-linked" | "no-login" | "disconnected" | "unavailable" | "invalid";

export type WaiverLoad =
  | { kind: "ok"; view: SeasonView; pickups: Pickup[]; ahead: { hole: WeekHole; fills: AheadFill[] }[]; considered: number; fetchedAt: Date }
  | { kind: "problem"; problem: Problem };

export type FillLoad = { kind: "ok"; holes: Hole[]; fills: HoleFills[] } | { kind: "problem"; problem: Problem };

type Cache = Map<string, { agents: FreeAgent[]; fetchedAt: number }>;
const TTL_MS = 10 * 60 * 1000;
const g = globalThis as { __espnWaiverCache?: Cache };

/** Drops the cached pool for a league, after the user has added a player from it. */
export function forgetWaivers(userId: string, leagueId: string) {
  for (const key of g.__espnWaiverCache?.keys() ?? []) if (key.startsWith(`${userId}:${leagueId}:`)) g.__espnWaiverCache!.delete(key);
}

/** A player in the pool last read for this league, while it's cached: who the app is adding (APE-386). */
export function pooledPlayer(userId: string, leagueId: string, playerId: number): FreeAgent | null {
  for (const [key, hit] of g.__espnWaiverCache ?? []) {
    if (!key.startsWith(`${userId}:${leagueId}:`)) continue;
    const found = hit.agents.find((a) => a.playerId === playerId);
    if (found) return found;
  }
  return null;
}

type PoolRead = { kind: "ok"; view: SeasonView; pool: PoolPlayer[]; fetchedAt: Date } | { kind: "problem"; problem: Problem };

/**
 * The available players at `positions` (ESPN slot ids), most-rostered first, scored for the league
 * like a roster is. Cached per league, week and filter.
 */
async function readPool(
  db: Db,
  key: Buffer,
  userId: string,
  leagueId: string,
  { positions, limit, refresh, name, offset }: { positions: readonly number[]; limit: number; refresh: boolean } & Narrow,
): Promise<PoolRead> {
  // The view first: it reads ESPN when the cache is cold, and the league read after it is then a hit.
  const viewLoad = await loadSeasonView(db, key, userId, leagueId);
  if (viewLoad.kind !== "ok") return { kind: "problem", problem: viewLoad.kind };
  const season = await loadSeason(db, key, userId, leagueId);
  if (season.kind !== "ok") return { kind: "problem", problem: season.kind };
  const { league } = season;
  const { view } = viewLoad;

  const cache: Cache = (g.__espnWaiverCache ??= new Map());
  const cacheKey = `${userId}:${leagueId}:${league.espnLeagueId}:${league.season}:${league.currentWeek}:${positions.join(",")}:${limit}:${offset ?? 0}:${name?.toLowerCase() ?? ""}`;
  let hit = cache.get(cacheKey);
  if (!hit || refresh || Date.now() - hit.fetchedAt >= TTL_MS) {
    const login = await loadLogin(db, key, userId);
    if (!login) return { kind: "problem", problem: "no-login" };
    const read = await readEspnLeague(login, {
      season: league.season,
      espnLeagueId: league.espnLeagueId,
      views: ["kona_player_info"],
      scoringPeriodId: league.currentWeek,
      filter: freeAgentFilter(league.season, league.currentWeek, positions, limit, { name, offset }),
    });
    if (!read.ok) {
      if (read.reason === "auth" && (await confirmSignedOut(db, userId, login, league))) return { kind: "problem", problem: "disconnected" };
      console.warn(`[espn-season] free agents unavailable: ${read.detail}`);
      if (!hit) return { kind: "problem", problem: "unavailable" };
    } else {
      hit = { agents: parseFreeAgents(read.data), fetchedAt: Date.now() };
      // Every search is its own entry, so drop the expired ones as new ones arrive.
      for (const [k, v] of cache) if (Date.now() - v.fetchedAt >= TTL_MS) cache.delete(k);
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
  return { kind: "ok", view, pool, fetchedAt: new Date(hit.fetchedAt) };
}

export async function loadWaivers(db: Db, key: Buffer, userId: string, leagueId: string, { refresh = false }: { refresh?: boolean } = {}): Promise<WaiverLoad> {
  const read = await readPool(db, key, userId, leagueId, { positions: POSITIONS, limit: POOL_SIZE, refresh });
  if (read.kind !== "ok") return read;
  const { view, pool } = read;
  // Next week's holes (APE-353), filled from the same pool: a claim placed now clears in time.
  return { kind: "ok", view, pickups: rankPickups(view, pool), ahead: rankAhead(view, nextWeekHoles(view), pool), considered: pool.length, fetchedAt: read.fetchedAt };
}

export type SearchLoad = { kind: "ok"; view: SeasonView; players: Pickup[]; more: boolean; fetchedAt: Date } | { kind: "problem"; problem: Problem };

/**
 * Search and browse (APE-409): a page of the available players at `position` (all of them without
 * one) whose names match `name`, most-rostered first, each valued for the user's lineup however
 * little he adds. Searched players stay in the pool cache, so the acquire routes know who they are.
 */
export async function searchPlayers(
  db: Db,
  key: Buffer,
  userId: string,
  leagueId: string,
  { name, position, offset = 0, refresh = false }: { name?: string; position?: Position; offset?: number; refresh?: boolean },
): Promise<SearchLoad> {
  // One more than a page, to know whether there's another.
  const read = await readPool(db, key, userId, leagueId, { positions: position ? [POSITION_SLOT[position]] : POSITIONS, limit: SEARCH_PAGE + 1, refresh, name, offset });
  if (read.kind !== "ok") return read;
  const players = read.pool.slice(0, SEARCH_PAGE).flatMap((p) => valuePickup(read.view, p) ?? []);
  return { kind: "ok", view: read.view, players, more: read.pool.length > SEARCH_PAGE, fetchedAt: read.fetchedAt };
}

/**
 * The available player the app is adding (APE-409): from the pool cache, or read from ESPN by id
 * when the cache has expired since the user found him. Null when ESPN says he isn't available.
 */
export async function availablePlayer(db: Db, key: Buffer, userId: string, leagueId: string, playerId: number): Promise<FreeAgent | null> {
  const pooled = pooledPlayer(userId, leagueId, playerId);
  if (pooled) return pooled;
  const season = await loadSeason(db, key, userId, leagueId);
  const login = season.kind === "ok" ? await loadLogin(db, key, userId) : null;
  if (season.kind !== "ok" || !login) return null;
  const { league } = season;
  const filter = freeAgentFilter(league.season, league.currentWeek, POSITIONS, 1);
  const read = await readEspnLeague(login, {
    season: league.season,
    espnLeagueId: league.espnLeagueId,
    views: ["kona_player_info"],
    scoringPeriodId: league.currentWeek,
    filter: { players: { ...filter.players, filterIds: { value: [playerId] } } },
  });
  return read.ok ? (parseFreeAgents(read.data).find((a) => a.playerId === playerId) ?? null) : null;
}

/**
 * This week's holes in the user's lineup (APE-349), and the best ways to fill the hard ones from the
 * pool at the positions that can play them. No ESPN pool read when there's nothing to fill.
 */
export async function loadFills(db: Db, key: Buffer, userId: string, leagueId: string, { refresh = false, now = Date.now() }: { refresh?: boolean; now?: number } = {}): Promise<FillLoad> {
  const viewLoad = await loadSeasonView(db, key, userId, leagueId);
  if (viewLoad.kind !== "ok") return { kind: "problem", problem: viewLoad.kind };
  const holes = findHoles(viewLoad.view);
  const hard = holes.filter((h) => h.kind === "hard");
  if (!hard.length) return { kind: "ok", holes, fills: [] };
  const eligible = new Set(hard.flatMap((h) => SLOT_DEFS.find((d) => d.key === h.key)?.eligible ?? []));
  const positions = Object.entries(POSITION_SLOT).flatMap(([pos, id]) => (eligible.has(pos as Position) ? [id] : []));
  const read = await readPool(db, key, userId, leagueId, { positions, limit: FILL_POOL_SIZE, refresh });
  if (read.kind !== "ok") return read;
  return { kind: "ok", holes, fills: rankFills(read.view, holes, read.pool, now) };
}
