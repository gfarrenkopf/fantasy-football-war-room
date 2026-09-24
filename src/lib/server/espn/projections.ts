import "server-only";
import { parseProjections, projectionFilter } from "@/lib/season/projections";
import type { PlayerProjections } from "@/lib/season/types";

/**
 * ESPN's weekly projections, fetched per player and cached (10.1). The view is public, so no ESPN
 * credentials are involved, and one cache serves every league: projections are raw stats, scored
 * per league afterwards (src/lib/season/scoring.ts).
 *
 * Unofficial endpoint (docs/espn-protocol.md §8): when a refresh fails, keep serving what we had;
 * an hour-old projection still sets a sensible lineup.
 */

/** ESPN's default PPR league. Its scoring doesn't matter: only the raw stats are read. */
const url = (season: number) => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`;
/** Players per request. A hundred players across a season of weeks is about 2 MB. */
const BATCH = 100;

export interface ProjectionQuery {
  season: number;
  playerIds: readonly number[];
  /** First and last NFL week to project, inclusive. */
  fromWeek: number;
  toWeek: number;
  /** Overrides the source's freshness for this call, e.g. shorter on a Sunday morning. */
  maxAgeMs?: number;
}

export type ProjectionSource = (query: ProjectionQuery) => Promise<Map<number, PlayerProjections>>;

export interface ProjectionSourceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
}

interface Entry {
  range: string;
  player: PlayerProjections;
  fetchedAt: number;
}

export function createProjectionSource({
  fetchImpl = fetch,
  now = Date.now,
  ttlMs = 60 * 60 * 1000,
  timeoutMs = 15_000,
}: ProjectionSourceOptions = {}): ProjectionSource {
  const cache = new Map<number, Entry>();

  async function fetchBatch(season: number, ids: number[], fromWeek: number, toWeek: number): Promise<PlayerProjections[]> {
    const res = await fetchImpl(url(season), {
      headers: { "X-Fantasy-Filter": projectionFilter(season, ids, fromWeek, toWeek), Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ESPN projections: HTTP ${res.status}`);
    return parseProjections(await res.json(), season);
  }

  return async ({ season, playerIds, fromWeek, toWeek, maxAgeMs = ttlMs }) => {
    const range = `${season}:${fromWeek}-${toWeek}`;
    const fresh = (e: Entry | undefined): e is Entry => !!e && e.range === range && now() - e.fetchedAt < maxAgeMs;
    const wanted = [...new Set(playerIds)];
    const missing = wanted.filter((id) => !fresh(cache.get(id)));

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      try {
        const fetchedAt = now();
        for (const player of await fetchBatch(season, batch, fromWeek, toWeek)) cache.set(player.id, { range, player, fetchedAt });
      } catch (err) {
        const stale = batch.filter((id) => cache.get(id)?.range === range);
        if (stale.length < batch.length) throw err;
        console.warn(`[espn-sync] projection refresh failed, serving cached projections: ${(err as Error).message}`);
      }
    }

    const out = new Map<number, PlayerProjections>();
    for (const id of wanted) {
      const entry = cache.get(id);
      if (entry?.range === range) out.set(id, entry.player);
    }
    return out;
  };
}

const g = globalThis as { __espnProjectionSource?: ProjectionSource };

/** The process-wide source, surviving hot reloads like the db pool does. */
export const getEspnProjections: ProjectionSource = (query) => (g.__espnProjectionSource ??= createProjectionSource())(query);
