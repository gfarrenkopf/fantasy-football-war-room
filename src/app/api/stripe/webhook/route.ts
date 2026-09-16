import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { getStripe } from "@/lib/server/stripe";
import { handleStripeEvent } from "@/lib/server/stripeWebhook";

const ROUTE = "/api/stripe/webhook";

/**
 * POST /api/stripe/webhook: Stripe's event notifications. Not behind withUser: Stripe has no
 * session and posts cross-origin, so the signature is the only authentication.
 *
 * 404 when payments are off, 400 for a missing or bad signature (nothing is read or written),
 * 200 once an event is handled or deliberately ignored, 500 (logged) when handling fails, so Stripe retries.
 */
export async function POST(request: Request): Promise<Response> {
  const stripe = getStripe();
  if (!stripe || !config.stripeWebhookSecret) return error(404, "Not found");

  const signature = request.headers.get("stripe-signature");
  if (!signature) return error(400, "Missing Stripe signature");
  // The signature covers the exact bytes Stripe sent, so read the raw text, never parsed JSON.
  const payload = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, config.stripeWebhookSecret);
  } catch {
    return error(400, "Invalid Stripe signature");
  }

  try {
    const outcome = await handleStripeEvent(getDb(), event);
    if (outcome === "no-league" || outcome === "no-metadata") {
      console.warn(`[payments] ${event.type} ${event.id}: ${outcome === "no-league" ? "league not found for its user" : "no season pass metadata"}; not granted`);
    }
    return json(200, { received: true, outcome });
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(500, "Couldn't process the event");
  }
}
