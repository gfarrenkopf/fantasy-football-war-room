import type Stripe from "stripe";
import type { Db } from "@/lib/db/types";
import { grantEntitlement, SEASON_PASS, type GrantResult } from "./entitlements";

export type WebhookOutcome =
  | GrantResult
  /** An event type we don't act on, or a session that isn't paid yet (e.g. a bank transfer in flight). */
  | "ignored"
  /** A paid session missing the metadata checkout sets: not ours, or created by hand in the dashboard. */
  | "no-metadata";

/**
 * Acts on a Stripe event whose signature has already been verified. A season pass is granted when
 * its Checkout session is paid: at completion for cards, or on `async_payment_succeeded` for
 * delayed methods. Every outcome is final, so the route answers 200 and Stripe stops retrying;
 * only a thrown error (e.g. the database is down) should make Stripe try again.
 */
export async function handleStripeEvent(db: Db, event: Stripe.Event): Promise<WebhookOutcome> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return "ignored";
  const session = event.data.object;
  if (session.payment_status !== "paid") return "ignored";

  const { leagueId, userId, kind } = session.metadata ?? {};
  if (!leagueId || !userId || kind !== SEASON_PASS) return "no-metadata";
  return grantEntitlement(db, {
    leagueId,
    userId,
    kind,
    source: session.id,
    amountTotal: session.amount_total,
    currency: session.currency,
  });
}
