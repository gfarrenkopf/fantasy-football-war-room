import "server-only";
import { parseSchedule, type Schedule } from "@/lib/season/schedule";

/**
 * ESPN's NFL schedule (11.4), from the public `proTeamSchedules_wl` view: no credentials, one fetch
 * for the whole season. Cached for a few hours, since kickoff times only change when the league
 * flexes a game; when a refresh fails, the last good read is served.
 */

const url = (season: number) => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}?view=proTeamSchedules_wl`;

export type ScheduleSource = (season: number) => Promise<Schedule>;

type Cache = Map<number, { schedule: Schedule; fetchedAt: number }>;

export function createScheduleSource({
  fetchImpl = fetch,
  now = Date.now,
  ttlMs = 6 * 60 * 60 * 1000,
  cache = new Map(),
}: { fetchImpl?: typeof fetch; now?: () => number; ttlMs?: number; cache?: Cache } = {}): ScheduleSource {
  return async (season) => {
    const hit = cache.get(season);
    if (hit && now() - hit.fetchedAt < ttlMs) return hit.schedule;
    try {
      const res = await fetchImpl(url(season), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const schedule = parseSchedule(await res.json());
      if (!schedule.size) throw new Error("no games in the response");
      cache.set(season, { schedule, fetchedAt: now() });
      return schedule;
    } catch (err) {
      if (!hit) throw new Error(`ESPN schedule: ${(err as Error).message}`);
      console.warn(`[espn-season] schedule refresh failed, serving the cached one: ${(err as Error).message}`);
      return hit.schedule;
    }
  };
}

const g = globalThis as { __espnScheduleCache?: Cache };

/** The process-wide source. Only its cache survives hot reloads, as for the season loader. */
export const getEspnSchedule: ScheduleSource = (season) => createScheduleSource({ cache: (g.__espnScheduleCache ??= new Map()) })(season);
