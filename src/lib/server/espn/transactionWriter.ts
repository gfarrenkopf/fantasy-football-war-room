import "server-only";
import type { EspnAcquireItem } from "@/lib/season/acquire";
import type { EspnLineupItem } from "@/lib/season/apply";
import type { EspnLogin } from "./logins";

/**
 * Sends a roster transaction to ESPN with the user's stored login: lineup moves (12.1), IR, adds and
 * drops, waiver claims and trades (Epic 13). Unofficial API (docs/espn-protocol.md §8, "Lineup
 * writes" and "Roster transactions"): one POST per transaction, which ESPN applies whole or not at
 * all. The login is sent as cookies and never logged.
 *
 * Callers check the transaction against a fresh read first (guardedWrite.ts): ESPN has no dry run
 * and doesn't check `fromLineupSlotId`.
 */

/** A transaction's `type`. `ROSTER` carries lineup moves, IR included. */
export type EspnTransactionType = "ROSTER" | "FREEAGENT" | "WAIVER" | "TRADE_PROPOSAL";

/** One item of a transaction. `ADD` / `DROP` / `TRADE` move players between teams; team 0 is the pool. */
export type EspnItem =
  | EspnLineupItem
  | EspnAcquireItem
  | { playerId: number; type: "TRADE"; fromTeamId: number; toTeamId: number };

export type EspnWrite =
  /** `id` is the stored transaction's, when ESPN sent one: a claim or proposal is cancelled by it. */
  | { ok: true; id: string | null }
  /** auth: ESPN refused the login. refused: ESPN said no (409), with its reasons. */
  | { ok: false; reason: "auth"; detail: string }
  | { ok: false; reason: "refused"; detail: string; errors: { type: string; message: string }[] }
  | { ok: false; reason: "unavailable"; detail: string };

export interface EspnTransaction {
  season: number;
  espnLeagueId: string;
  /** The user's own team, from their season link: never taken from a request. */
  teamId: number;
  /** The NFL week the transaction is for (ESPN's `scoringPeriodId`). */
  week: number;
  type: EspnTransactionType;
  items: readonly EspnItem[];
  /** CANCEL withdraws the pending claim or proposal named by `relatedTransactionId`, with no items. */
  executionType?: "EXECUTE" | "CANCEL";
  relatedTransactionId?: string;
  /** A waiver claim's FAAB bid; null in leagues that don't bid. */
  bidAmount?: number | null;
}

export async function writeEspnTransaction(
  login: EspnLogin,
  { season, espnLeagueId, teamId, week, type, items, executionType = "EXECUTE", relatedTransactionId, bidAmount }: EspnTransaction,
  { fetchImpl = fetch, timeoutMs = 20_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EspnWrite> {
  if (!/^\d{1,12}$/.test(espnLeagueId)) return { ok: false, reason: "unavailable", detail: "bad league id" };
  const url = `https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}/transactions/`;
  const body = {
    isLeagueManager: false,
    teamId,
    type,
    memberId: login.swid,
    scoringPeriodId: week,
    executionType,
    items,
    ...(relatedTransactionId === undefined ? {} : { relatedTransactionId }),
    ...(bidAmount === undefined ? {} : { bidAmount }),
  };
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
  const json = (await res.json().catch(() => null)) as { id?: unknown; details?: unknown } | null;
  if (res.ok) return { ok: true, id: typeof json?.id === "string" ? json.id : null };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth", detail: `HTTP ${res.status}` };
  const errors = (Array.isArray(json?.details) ? json.details : []).flatMap((d: unknown) =>
    typeof d === "object" && d !== null && typeof (d as { type?: unknown }).type === "string"
      ? [{ type: (d as { type: string }).type, message: typeof (d as { message?: unknown }).message === "string" ? (d as { message: string }).message : "" }]
      : [],
  );
  if (res.status === 409 || errors.length) return { ok: false, reason: "refused", detail: `HTTP ${res.status} ${errors.map((e) => e.type).join(", ")}`.trim(), errors };
  return { ok: false, reason: "unavailable", detail: `HTTP ${res.status}` };
}
