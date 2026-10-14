import "server-only";
import type { Db } from "@/lib/db/types";
import { addFreeAgent, cancelClaim, claimWaiver, type AcquireLanded, type AcquireRequest } from "./acquire";
import type { GuardedOutcome } from "./guardedWrite";
import { isObject, readSnapshot } from "./lineupWrite";
import { forgetWaivers } from "./waivers";
import { consentOf } from "./writeRoute";

/**
 * Adding, claiming and cancelling a claim on ESPN, as both the web's acquire route and the app's
 * (Epic 13, APE-386) do it, once the consent gate has passed: the guarded write, then an alert for a
 * write ESPN took that the re-read doesn't show.
 */

export type AcquireBody = ({ kind: "add" | "claim" } & AcquireRequest) | { kind: "cancel"; week: number; claimId: string };

/** What landed, by kind: `{ added, dropped }` for an add, `{ pending }` for a claim, `{ cancelled }` for a cancel. */
export type AcquireResult = AcquireLanded | { pending: boolean } | { cancelled: boolean };

const isId = (v: unknown): v is number => Number.isInteger(v);

/** An add, claim or cancel from a request body, or null when it isn't one. */
export function parseAcquire(body: unknown): (AcquireBody & { consentVersion: number | null }) | null {
  if (!isObject(body) || !isId(body.week)) return null;
  const consentVersion = consentOf(body);
  if (body.kind === "cancel") return typeof body.claimId === "string" && /^[\w-]{1,64}$/.test(body.claimId) ? { kind: "cancel", week: body.week, claimId: body.claimId, consentVersion } : null;
  if ((body.kind !== "add" && body.kind !== "claim") || !isId(body.add) || !(body.drop === null || isId(body.drop))) return null;
  const snapshot = readSnapshot(body.snapshot);
  if (!snapshot) return null;
  return { kind: body.kind, week: body.week, snapshot, add: body.add, drop: body.drop, consentVersion };
}

export async function writeAcquire(db: Db, key: Buffer, userId: string, leagueId: string, body: AcquireBody, alert: (message: string) => void): Promise<{ what: string; out: GuardedOutcome<AcquireResult> }> {
  if (body.kind === "cancel") {
    const out = await cancelClaim(db, key, userId, leagueId, body);
    if (out.kind === "applied" && !out.landed.cancelled) alert(`ESPN claim cancel didn't land: ${body.claimId} still pending`);
    return { what: "claim cancel", out };
  }
  if (body.kind === "claim") {
    const out = await claimWaiver(db, key, userId, leagueId, body);
    if (out.kind === "applied" && !out.landed.pending) alert(`ESPN waiver claim didn't land: add ${body.add} not pending`);
    return { what: "waiver claim", out };
  }
  const out = await addFreeAgent(db, key, userId, leagueId, body);
  if (out.kind === "applied" || out.kind === "unverified") forgetWaivers(userId, leagueId);
  if (out.kind === "applied" && (!out.landed.added || !out.landed.dropped)) {
    alert(`ESPN free-agent add didn't land: add ${body.add} ${out.landed.added ? "in" : "missing"}, drop ${body.drop} ${out.landed.dropped ? "gone" : "still there"}`);
  }
  return { what: "free-agent add", out };
}
