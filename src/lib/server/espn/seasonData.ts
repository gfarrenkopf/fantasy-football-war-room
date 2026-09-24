import "server-only";
import type { Db } from "@/lib/db/types";
import { parseSeasonLeague } from "@/lib/season/espnLeague";
import type { SeasonLeague } from "@/lib/season/types";
import { readEspnLeague } from "./leagueReader";
import { loadLogin, loginStatus, markDisconnected, markVerified } from "./logins";
import { findSeasonLink } from "./seasonLinks";

/**
 * Every team's roster, read from ESPN with the user's stored login (10.4). ESPN is the source of
 * truth: nothing about rosters is kept in War Room beyond a few minutes' cache, and when ESPN can't
 * be reached, the last good read is served, marked stale.
 */

export type SeasonLoad =
  | { kind: "ok"; league: SeasonLeague; espnTeamId: number; fetchedAt: Date; stale: boolean }
  /** This war room league isn't following an ESPN league. */
  | { kind: "not-linked" }
  /** No stored login, or ESPN refused it: the user needs to click the bookmarklet again. */
  | { kind: "no-login" }
  | { kind: "disconnected" }
  | { kind: "unavailable" }
  /** ESPN answered with something War Room can't use. */
  | { kind: "invalid"; error: string };

export type SeasonLoader = (db: Db, key: Buffer, userId: string, leagueId: string, options?: { refresh?: boolean }) => Promise<SeasonLoad>;

const VIEWS = ["mSettings", "mStatus", "mRoster", "mTeam", "mPendingTransactions"] as const;

export function createSeasonLoader({ fetchImpl, now = () => new Date(), ttlMs = 3 * 60 * 1000 }: { fetchImpl?: typeof fetch; now?: () => Date; ttlMs?: number } = {}): SeasonLoader {
  const cache = new Map<string, { league: SeasonLeague; espnTeamId: number; fetchedAt: Date }>();

  return async (db, key, userId, leagueId, { refresh = false } = {}) => {
    const link = await findSeasonLink(db, userId, leagueId);
    if (!link) return { kind: "not-linked" };

    const cacheKey = `${userId}:${leagueId}:${link.espnLeagueId}:${link.season}`;
    const hit = cache.get(cacheKey);
    if (hit && !refresh && now().getTime() - hit.fetchedAt.getTime() < ttlMs) return { kind: "ok", ...hit, espnTeamId: link.espnTeamId, stale: false };

    const login = await loadLogin(db, key, userId, now());
    if (!login) return (await loginStatus(db, userId, now()))?.status === "disconnected" ? { kind: "disconnected" } : { kind: "no-login" };

    const read = await readEspnLeague(login, { season: link.season, espnLeagueId: link.espnLeagueId, views: VIEWS }, { fetchImpl });
    if (!read.ok) {
      if (read.reason === "auth") {
        await markDisconnected(db, userId, now());
        return { kind: "disconnected" };
      }
      if (read.reason === "not-found") return { kind: "invalid", error: `ESPN no longer has league ${link.espnLeagueId} for ${link.season}.` };
      console.warn(`[espn-season] league read failed: ${read.detail}`);
      return hit ? { kind: "ok", ...hit, espnTeamId: link.espnTeamId, stale: true } : { kind: "unavailable" };
    }

    const parsed = parseSeasonLeague(read.data, link.espnLeagueId);
    if (!parsed.ok) return { kind: "invalid", error: parsed.error };
    const entry = { league: parsed.league, espnTeamId: link.espnTeamId, fetchedAt: now() };
    cache.set(cacheKey, entry);
    await markVerified(db, userId, entry.fetchedAt);
    return { kind: "ok", ...entry, stale: false };
  };
}

const g = globalThis as { __espnSeasonLoader?: SeasonLoader };

/** The process-wide loader, surviving hot reloads like the db pool does. */
export const loadSeason: SeasonLoader = (...args) => (g.__espnSeasonLoader ??= createSeasonLoader())(...args);
