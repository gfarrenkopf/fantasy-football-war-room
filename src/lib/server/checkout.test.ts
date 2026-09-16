import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { entitlements } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { startCheckout, type CreateCheckoutSession } from "./checkout";
import { SEASON_PASS } from "./entitlements";
import { deleteLeague } from "./leagues";
import { createTestLeague } from "./testLeagues";

let db: Db;
let close: () => Promise<void>;
let alice: string;
let bob: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  alice = await createTestUser(db);
  bob = await createTestUser(db);
});

const league = (userId: string) => createTestLeague(db, userId);

function fakeStripe(url: string | null = "https://checkout.stripe.com/c/pay/cs_test_1") {
  const calls: Stripe.Checkout.SessionCreateParams[] = [];
  const create: CreateCheckoutSession = async (params) => (calls.push(params), { url });
  return { create, calls };
}

const options = (userId: string, leagueId: string) => ({
  userId,
  email: "alice@example.test",
  leagueId,
  priceId: "price_test",
  baseUrl: "https://draftroom.example",
});

describe("startCheckout", () => {
  it("creates a one-time payment session carrying the league and user", async () => {
    const id = await league(alice);
    const stripe = fakeStripe();
    expect(await startCheckout(db, stripe.create, options(alice, id))).toEqual({ status: "ok", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0]).toMatchObject({
      mode: "payment",
      line_items: [{ price: "price_test", quantity: 1 }],
      client_reference_id: id,
      metadata: { leagueId: id, userId: alice, kind: SEASON_PASS },
      customer_email: "alice@example.test",
      success_url: `https://draftroom.example/?checkout=success&league=${id}`,
      cancel_url: `https://draftroom.example/?checkout=cancel&league=${id}`,
    });
  });

  it("won't sell a pass for someone else's, a deleted, or an unknown league", async () => {
    const stripe = fakeStripe();
    const bobs = await league(bob);
    const deleted = await league(alice);
    await deleteLeague(db, alice, deleted);
    for (const id of [bobs, deleted, "no-such-league"]) {
      expect(await startCheckout(db, stripe.create, options(alice, id))).toEqual({ status: "not-found" });
    }
    expect(stripe.calls).toEqual([]);
  });

  it("won't sell a second pass for a league that has one", async () => {
    const id = await league(alice);
    await db.insert(entitlements).values({ leagueId: id, kind: SEASON_PASS, source: "cs_test_earlier" });
    const stripe = fakeStripe();
    expect(await startCheckout(db, stripe.create, options(alice, id))).toEqual({ status: "already-paid" });
    expect(stripe.calls).toEqual([]);
  });

  it("omits the email when the account has none, and throws when Stripe returns no URL", async () => {
    const id = await league(alice);
    const stripe = fakeStripe(null);
    await expect(startCheckout(db, stripe.create, { ...options(alice, id), email: null })).rejects.toThrow(/without a URL/);
    expect(stripe.calls[0]).not.toHaveProperty("customer_email");
  });
});
