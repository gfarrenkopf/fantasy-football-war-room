import "server-only";
import Stripe from "stripe";
import { config } from "@/lib/config";

let client: Stripe | null = null;

/**
 * The Stripe client, or null when payments are off. Built on first use, never at import, so route
 * modules load (and `next build` runs) with no Stripe variables set.
 */
export function getStripe(): Stripe | null {
  if (!config.paymentsEnabled || !config.stripeSecretKey) return null;
  client ??= new Stripe(config.stripeSecretKey);
  return client;
}
