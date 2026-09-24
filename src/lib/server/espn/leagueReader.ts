import "server-only";
import type { EspnLogin } from "./logins";

/**
 * Reads a private ESPN league with the user's stored login (Epic 10). Unofficial API
 * (docs/espn-protocol.md §8). The login is sent as cookies and never logged; errors say only what
 * went wrong, so they're safe to log.
 */

export type EspnRead =
  | { ok: true; data: unknown }
  /** auth: ESPN refused the login (signed out, or not a member). not-found: no such league or season. */
  | { ok: false; reason: "auth" | "not-found" | "unavailable"; detail: string };

export interface EspnLeagueQuery {
  season: number;
  espnLeagueId: string;
  views: readonly string[];
  scoringPeriodId?: number;
}

export async function readEspnLeague(
  login: EspnLogin,
  { season, espnLeagueId, views, scoringPeriodId }: EspnLeagueQuery,
  // Generous: a league with every roster is a couple of megabytes (outlooks and stats for every
  // player), and ESPN has taken anywhere from 1 to 30 seconds to send it (2026-09-24).
  { fetchImpl = fetch, timeoutMs = 45_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EspnRead> {
  if (!/^\d{1,12}$/.test(espnLeagueId)) return { ok: false, reason: "not-found", detail: "bad league id" };
  const query = [...views.map((v) => `view=${encodeURIComponent(v)}`), ...(scoringPeriodId ? [`scoringPeriodId=${scoringPeriodId}`] : [])].join("&");
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}?${query}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Cookie: `espn_s2=${login.espnS2}; SWID=${login.swid}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, reason: "unavailable", detail: timedOut(err) ? `timed out after ${timeoutMs / 1000}s` : (err as Error).name };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth", detail: `HTTP ${res.status}` };
  if (res.status === 404) return { ok: false, reason: "not-found", detail: "HTTP 404" };
  if (!res.ok) return { ok: false, reason: "unavailable", detail: `HTTP ${res.status}` };
  // The timeout covers the body too, and a slow body is the usual failure: read it before parsing,
  // so an abort part-way through isn't mistaken for ESPN sending something that isn't JSON.
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: "unavailable", detail: timedOut(err) ? `timed out after ${timeoutMs / 1000}s reading the response` : (err as Error).name };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "unavailable", detail: `not JSON (${res.headers.get("content-type") ?? "no content type"})` };
  }
}

const timedOut = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
