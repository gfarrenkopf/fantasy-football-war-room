import "server-only";
import { parseEspnPlayers, type EspnPlayer } from "@/lib/espn/crosswalk";

/**
 * ESPN's public player list, fetched once and cached per season (8.1). The crosswalk needs it to
 * name the player behind each ESPN id. It's public, so no ESPN credentials are involved.
 *
 * Unofficial endpoint (docs/espn-protocol.md §2): when a refresh fails, keep serving the last good
 * list; a list a few hours old still names every drafted player.
 */

const url = (season: number) => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?view=players_wl`;
/** Only active players; without this ESPN returns every player it has ever listed. */
const FILTER = JSON.stringify({ filterActive: { value: true } });

export interface PlayerSourceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** How long a fetched list is fresh. Rosters barely move during a draft. */
  ttlMs?: number;
  timeoutMs?: number;
}

interface Entry {
  players: EspnPlayer[];
  fetchedAt: number;
}

export type PlayerSource = (season: number) => Promise<EspnPlayer[]>;

export function createPlayerSource({
  fetchImpl = fetch,
  now = Date.now,
  ttlMs = 6 * 60 * 60 * 1000,
  timeoutMs = 10_000,
}: PlayerSourceOptions = {}): PlayerSource {
  const cache = new Map<number, Entry>();
  const inFlight = new Map<number, Promise<EspnPlayer[]>>();

  async function refresh(season: number): Promise<EspnPlayer[]> {
    const res = await fetchImpl(url(season), {
      headers: { "X-Fantasy-Filter": FILTER, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ESPN player list: HTTP ${res.status}`);
    const players = parseEspnPlayers(await res.json());
    cache.set(season, { players, fetchedAt: now() });
    return players;
  }

  return async (season) => {
    const hit = cache.get(season);
    if (hit && now() - hit.fetchedAt < ttlMs) return hit.players;
    let pending = inFlight.get(season);
    if (!pending) {
      pending = refresh(season).finally(() => inFlight.delete(season));
      inFlight.set(season, pending);
    }
    try {
      return await pending;
    } catch (err) {
      if (hit) {
        console.warn(`[espn-sync] player list refresh failed, serving the cached list: ${(err as Error).message}`);
        return hit.players;
      }
      throw err;
    }
  };
}

const g = globalThis as { __espnPlayerSource?: PlayerSource };

/** The process-wide source, surviving hot reloads like the db pool does. */
export const getEspnPlayers: PlayerSource = (season) => (g.__espnPlayerSource ??= createPlayerSource())(season);
