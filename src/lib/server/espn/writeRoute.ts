import "server-only";
import type { Db } from "@/lib/db/types";
import { ESPN_WRITE_DISCLOSURE, ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { espnRefusal } from "@/lib/season/apply";
import { error, json } from "@/lib/server/http";
import { agreeToWrites, writeConsent } from "@/lib/server/seasonPrefs";
import type { GuardedOutcome } from "./guardedWrite";

/**
 * What every route that writes to the user's ESPN team shares (12.1, Epic 13): the consent gate,
 * and turning a guarded write's outcome into the answer the season page reads. The body shapes:
 *
 * - 409 `{ consent }` until the user has agreed to the current consent; sending its version agrees.
 * - 409 `{ changed }` when ESPN changed since staging, `{ problems }` when the checks fail against
 *   the fresh read, `{ refused }` when ESPN said no, and `{ problem }` when ESPN can't be read.
 *   Nothing landed in any of these.
 * - 502 `{ unverified: true }` when the write went out and ESPN couldn't be read after it.
 *
 * ESPN refusing, a write that fails, and a write that can't be checked all log [server-error]
 * through `alert`.
 */

/** The 409 to send until the user has agreed to the current consent, or null once they have. Agrees when they send its version. */
export async function consentGate(db: Db, userId: string, consentVersion: number | null): Promise<Response | null> {
  if (((await writeConsent(db, userId)) ?? 0) >= ESPN_WRITE_VERSION) return null;
  if (consentVersion !== ESPN_WRITE_VERSION) {
    return json(409, { error: "Agree to Draft Room changing your team on ESPN first", consent: { version: ESPN_WRITE_VERSION, lines: ESPN_WRITE_DISCLOSURE } });
  }
  await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
  return null;
}

/** A consent version from a request body, or null. */
export const consentOf = (body: Record<string, unknown>) => (Number.isInteger(body.consentVersion) ? (body.consentVersion as number) : null);

export interface WriteAnswer<Landed> {
  /** What was written, for alerts: "lineup apply", "free-agent add". */
  what: string;
  alert: (message: string) => void;
  /** The 200 for a write ESPN took, from what landed. Alerts for anything that didn't land are its to raise. */
  applied: (landed: Landed) => Response;
  /** Extra fields for the 502 when the write can't be checked. */
  unverified?: Record<string, unknown>;
}

export function writeResponse<Landed>(out: GuardedOutcome<Landed>, { what, alert, applied, unverified = {} }: WriteAnswer<Landed>): Response {
  switch (out.kind) {
    case "applied":
      return applied(out.landed);
    case "unverified":
      alert(`ESPN ${what} unverified: ${out.detail}`);
      return json(502, { error: "Draft Room sent your change, but couldn't read ESPN back to check it. Check your team on ESPN.", unverified: true, ...unverified });
    case "changed":
      return json(409, { error: "Your team changed on ESPN since this page loaded. Nothing was sent.", changed: out.changes });
    case "refused":
      return json(409, { error: "This can't be done on ESPN. Nothing was sent.", problems: out.problems });
    case "espn-refused":
      alert(`ESPN refused a ${what}: ${out.detail}`);
      return json(409, { error: "ESPN refused the change. Nothing changed.", refused: out.errors.length ? out.errors.map((e) => espnRefusal(e.type, e.message)) : ["ESPN didn't say why."] });
    case "write-failed":
      alert(`ESPN ${what} failed: ${out.detail}`);
      return error(502, "ESPN didn't take the change just now, and nothing changed. Try again in a minute.");
    case "problem":
      return json(409, { error: PROBLEM[out.problem], problem: out.problem });
  }
}

const PROBLEM: Record<string, string> = {
  "not-linked": "This league isn't connected to ESPN.",
  "no-login": "Draft Room needs your ESPN connection again. Nothing was sent.",
  disconnected: "ESPN signed Draft Room out. Reconnect with the bookmarklet, then try again. Nothing was sent.",
  unavailable: "Couldn't reach ESPN to check your team first, so nothing was sent. Try again in a minute.",
  invalid: "ESPN sent something Draft Room couldn't read, so nothing was sent.",
};
