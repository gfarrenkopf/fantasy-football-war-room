import type Stripe from "stripe";
import type { Db } from "@/lib/db/types";
import { hasEntitlement, SEASON_PASS } from "./entitlements";
import { findLeague } from "./leagues";

/** The one Stripe call checkout makes, so tests can stand in for Stripe. */
export type CreateCheckoutSession = (params: Stripe.Checkout.SessionCreateParams) => Promise<{ url: string | null }>;

export type StartCheckoutResult =
  | { status: "ok"; url: string }
  /** Not the user's league, deleted, or not synced to the server yet. */
  | { status: "not-found" }
  | { status: "already-paid" };

/**
 * Starts a Stripe Checkout for a league's season pass. The league and user ride along in the
 * session's metadata, which is how the webhook (4.3) knows what to grant. Stripe errors propagate.
 */
export async function startCheckout(
  db: Db,
  createSession: CreateCheckoutSession,
  { userId, email, leagueId, priceId, baseUrl }: { userId: string; email: string | null; leagueId: string; priceId: string; baseUrl: string },
): Promise<StartCheckoutResult> {
  const league = await findLeague(db, userId, leagueId);
  if (!league) return { status: "not-found" };
  if (await hasEntitlement(db, leagueId, SEASON_PASS)) return { status: "already-paid" };

  // Straight back into the war room, where CheckoutReturn reads the outcome. (`/` is the landing
  // page; it forwards its query string too, for sessions started before the route moved.)
  const back = (outcome: "success" | "cancel") => {
    const url = new URL("/draft", baseUrl);
    url.searchParams.set("checkout", outcome);
    url.searchParams.set("league", leagueId);
    return url.toString();
  };
  const metadata = { leagueId, userId, kind: SEASON_PASS };
  const session = await createSession({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: leagueId,
    metadata,
    payment_intent_data: { metadata, description: `Season pass: ${league.name} (${league.season})` },
    ...(email ? { customer_email: email } : {}),
    success_url: back("success"),
    cancel_url: back("cancel"),
  });
  if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
  return { status: "ok", url: session.url };
}
