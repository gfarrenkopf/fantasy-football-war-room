import "server-only";
import type { Db } from "@/lib/db/types";
import type { GuardedOutcome } from "./guardedWrite";
import { isObject, readSnapshot } from "./lineupWrite";
import { proposeTrade, respondToTrade, type ProposeRequest, type RespondRequest } from "./trades";
import { consentOf } from "./writeRoute";

/**
 * Trades on ESPN for the user's own team, as both the web's trades route and the app's (13.5,
 * APE-386) do them, once the consent gate has passed: the guarded write, then an alert for a write
 * ESPN took that the re-read doesn't show.
 */

export type TradeBody = ({ kind: "propose" } & ProposeRequest) | ({ kind: "respond" } & RespondRequest);

/** What landed: `{ pending }` for a proposal, `{ done }` for an accept, decline or withdraw. */
export type TradeResult = { pending: boolean } | { done: boolean };

const isId = (v: unknown): v is number => Number.isInteger(v);
const ids = (v: unknown, max: number): number[] | null => (Array.isArray(v) && v.length <= max && v.every(isId) ? v : null);

/** A proposal, or an answer to a pending trade, from a request body; null when it isn't one. */
export function parseTrade(body: unknown): (TradeBody & { consentVersion: number | null }) | null {
  if (!isObject(body) || !isId(body.week)) return null;
  const consentVersion = consentOf(body);
  if (body.kind === "propose") {
    const snapshot = readSnapshot(body.snapshot);
    const gives = ids(body.gives, 20);
    const gets = ids(body.gets, 20);
    const drops = ids(body.drops ?? [], 10);
    if (!snapshot || !gives || !gets || !drops || !isId(body.partner)) return null;
    return { kind: "propose", week: body.week, snapshot, partner: body.partner, gives, gets, drops, consentVersion };
  }
  if ((body.kind === "accept" || body.kind === "decline" || body.kind === "withdraw") && typeof body.tradeId === "string" && /^[\w-]{1,64}$/.test(body.tradeId)) {
    const snapshot = body.kind === "accept" ? readSnapshot(body.snapshot) : null;
    if (body.kind === "accept" && !snapshot) return null;
    return { kind: "respond", action: body.kind, week: body.week, snapshot, tradeId: body.tradeId, consentVersion };
  }
  return null;
}

export async function writeTrade(db: Db, key: Buffer, userId: string, leagueId: string, body: TradeBody, alert: (message: string) => void): Promise<{ what: string; out: GuardedOutcome<TradeResult> }> {
  if (body.kind === "propose") {
    const out = await proposeTrade(db, key, userId, leagueId, body);
    if (out.kind === "applied" && !out.landed.pending) alert(`ESPN trade proposal didn't land: not pending after writing (partner ${body.partner})`);
    return { what: "trade proposal", out };
  }
  const out = await respondToTrade(db, key, userId, leagueId, body);
  if (out.kind === "applied" && !out.landed.done) alert(`ESPN trade ${body.action} didn't land: ${body.tradeId}`);
  return { what: `trade ${body.action}`, out };
}
