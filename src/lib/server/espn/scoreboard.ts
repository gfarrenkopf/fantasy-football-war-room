import "server-only";
import { parseScoreboard, type Scoreboard } from "@/lib/season/scoreboard";

/**
 * ESPN's public NFL scoreboard (APE-196): whether each game this week is still to come, under way
 * or over. No credentials, and one fetch serves every league. Cached for a minute, about as fresh as
 * the roster read's live points; when a refresh fails, the last good read is served, and with none
 * the page shows points without a game status rather than failing.
 */

const url = (season: number, week: number) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`;

export type ScoreboardSource = (query: { season: number; week: number; maxAgeMs?: number }) => Promise<Scoreboard>;

type Cache = Map<string, { scoreboard: Scoreboard; fetchedAt: number }>;

export function createScoreboardSource({
  fetchImpl = fetch,
  now = Date.now,
  ttlMs = 60 * 1000,
  timeoutMs = 10_000,
  cache = new Map(),
}: { fetchImpl?: typeof fetch; now?: () => number; ttlMs?: number; timeoutMs?: number; cache?: Cache } = {}): ScoreboardSource {
  return async ({ season, week, maxAgeMs = ttlMs }) => {
    const key = `${season}:${week}`;
    const hit = cache.get(key);
    if (hit && now() - hit.fetchedAt < maxAgeMs) return hit.scoreboard;
    try {
      const res = await fetchImpl(url(season, week), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const scoreboard = parseScoreboard(await res.json());
      if (!scoreboard.size) throw new Error("no games in the response");
      cache.set(key, { scoreboard, fetchedAt: now() });
      return scoreboard;
    } catch (err) {
      console.warn(`[espn-season] scoreboard unavailable${hit ? ", serving the cached one" : ""}: ${(err as Error).message}`);
      return hit?.scoreboard ?? new Map();
    }
  };
}

const g = globalThis as { __espnScoreboardCache?: Cache };

/** The process-wide source. Only its cache survives hot reloads, as for the season loader. */
export const getEspnScoreboard: ScoreboardSource = (query) => createScoreboardSource({ cache: (g.__espnScoreboardCache ??= new Map()) })(query);
