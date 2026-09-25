import "server-only";
import type { EspnLineupItem } from "@/lib/season/apply";
import type { EspnLogin } from "./logins";

/**
 * Sends lineup moves to ESPN with the user's stored login (12.1). Unofficial API
 * (docs/espn-protocol.md §8, "Lineup writes"): every move goes in one `ROSTER` transaction, which
 * ESPN applies whole or not at all. The login is sent as cookies and never logged.
 *
 * Callers check the moves against a fresh read of the roster first (src/lib/season/apply.ts):
 * ESPN has no dry run and doesn't check `fromLineupSlotId`.
 */

export type EspnWrite =
  | { ok: true }
  /** auth: ESPN refused the login. refused: ESPN said no to the moves (409), with its reasons. */
  | { ok: false; reason: "auth"; detail: string }
  | { ok: false; reason: "refused"; detail: string; errors: { type: string; message: string }[] }
  | { ok: false; reason: "unavailable"; detail: string };

export interface EspnLineupWrite {
  season: number;
  espnLeagueId: string;
  /** The user's own team, from their season link: never taken from a request. */
  teamId: number;
  /** The NFL week the moves are for (ESPN's `scoringPeriodId`). */
  week: number;
  items: readonly EspnLineupItem[];
}

export async function writeEspnLineup(
  login: EspnLogin,
  { season, espnLeagueId, teamId, week, items }: EspnLineupWrite,
  { fetchImpl = fetch, timeoutMs = 20_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EspnWrite> {
  if (!/^\d{1,12}$/.test(espnLeagueId)) return { ok: false, reason: "unavailable", detail: "bad league id" };
  const url = `https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}/transactions/`;
  const body = { isLeagueManager: false, teamId, type: "ROSTER", memberId: login.swid, scoringPeriodId: week, executionType: "EXECUTE", items };
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Cookie: `espn_s2=${login.espnS2}; SWID=${login.swid}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as Error).name;
    return { ok: false, reason: "unavailable", detail: name === "TimeoutError" || name === "AbortError" ? `timed out after ${timeoutMs / 1000}s` : name };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth", detail: `HTTP ${res.status}` };
  const json = (await res.json().catch(() => null)) as { details?: unknown } | null;
  const errors = (Array.isArray(json?.details) ? json.details : []).flatMap((d: unknown) =>
    typeof d === "object" && d !== null && typeof (d as { type?: unknown }).type === "string"
      ? [{ type: (d as { type: string }).type, message: typeof (d as { message?: unknown }).message === "string" ? (d as { message: string }).message : "" }]
      : [],
  );
  if (res.status === 409 || errors.length) return { ok: false, reason: "refused", detail: `HTTP ${res.status} ${errors.map((e) => e.type).join(", ")}`.trim(), errors };
  return { ok: false, reason: "unavailable", detail: `HTTP ${res.status}` };
}
