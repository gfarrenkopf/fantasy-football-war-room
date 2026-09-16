import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { entitlements } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { hasEntitlement, SEASON_PASS } from "./entitlements";
import { createTestLeague } from "./testLeagues";

vi.mock("server-only", () => ({}));
const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => testDb.current }));

const SECRET = "whsec_test_secret";
const signer = new Stripe("sk_test_unused");

let db: Db;
let close: () => Promise<void>;
let alice: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  testDb.current = db;
});
afterAll(() => close());

function sessionEvent(metadata: Record<string, string> | null, patch: Record<string, unknown> = {}, type = "checkout.session.completed") {
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type,
    data: { object: { id: `cs_test_${crypto.randomUUID()}`, object: "checkout.session", payment_status: "paid", amount_total: 999, currency: "usd", metadata, ...patch } },
  };
}

/** The route, loaded with payments fully configured. */
async function route() {
  vi.stubEnv("DATABASE_URL", "postgres://localhost/unused");
  vi.stubEnv("NEXTAUTH_SECRET", "secret");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("STRIPE_PRICE_ID", "price_x");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return (await import("@/app/api/stripe/webhook/route")).POST;
}

function post(payload: string, signature: string | null) {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: signature === null ? {} : { "stripe-signature": signature },
    body: payload,
  });
}

const signed = (event: object, secret = SECRET) => {
  const payload = JSON.stringify(event);
  return post(payload, signer.webhooks.generateTestHeaderString({ payload, secret }));
};

describe("POST /api/stripe/webhook", () => {
  beforeEach(async () => {
    vi.resetModules();
    alice = await createTestUser(db);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("grants the season pass for a paid checkout, once, however often Stripe retries", async () => {
    const POST = await route();
    const leagueId = await createTestLeague(db, alice);
    const event = sessionEvent({ leagueId, userId: alice, kind: SEASON_PASS });

    const first = await POST(signed(event));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, outcome: "granted" });
    expect(await (await POST(signed(event))).json()).toEqual({ received: true, outcome: "exists" });
    expect(await hasEntitlement(db, leagueId, SEASON_PASS)).toBe(true);
  });

  it("rejects a missing, forged or tampered signature without writing anything", async () => {
    const POST = await route();
    const leagueId = await createTestLeague(db, alice);
    const event = sessionEvent({ leagueId, userId: alice, kind: SEASON_PASS });
    const payload = JSON.stringify(event);
    const tampered = signed(sessionEvent({ leagueId: "other", userId: alice, kind: SEASON_PASS }));
    const tamperedSignature = tampered.headers.get("stripe-signature")!;

    for (const request of [post(payload, null), signed(event, "whsec_wrong"), post(payload, "t=1,v1=deadbeef"), post(payload, tamperedSignature)]) {
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
    expect(await hasEntitlement(db, leagueId, SEASON_PASS)).toBe(false);
  });

  it("waits for delayed payments to succeed before granting", async () => {
    const POST = await route();
    const leagueId = await createTestLeague(db, alice);
    const metadata = { leagueId, userId: alice, kind: SEASON_PASS };
    const pending = sessionEvent(metadata, { payment_status: "unpaid" });
    expect(await (await POST(signed(pending))).json()).toMatchObject({ outcome: "ignored" });
    expect(await hasEntitlement(db, leagueId, SEASON_PASS)).toBe(false);

    const succeeded = sessionEvent(metadata, {}, "checkout.session.async_payment_succeeded");
    expect(await (await POST(signed(succeeded))).json()).toMatchObject({ outcome: "granted" });
  });

  it("acknowledges events it can't grant, so Stripe doesn't retry them forever", async () => {
    const POST = await route();
    const leagueId = await createTestLeague(db, alice);
    const cases: [object, string][] = [
      [{ ...sessionEvent(null), type: "customer.created" }, "ignored"],
      [sessionEvent(null), "no-metadata"],
      [sessionEvent({ leagueId, userId: alice, kind: "something_else" }), "no-metadata"],
      [sessionEvent({ leagueId: "no-such-league", userId: alice, kind: SEASON_PASS }), "no-league"],
    ];
    for (const [event, outcome] of cases) {
      const response = await POST(signed(event));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ outcome });
    }
    expect(await db.select().from(entitlements).then((rows) => rows.filter((r) => r.leagueId === leagueId))).toEqual([]);
  });

  it("answers 500 when the database fails, so Stripe retries", async () => {
    const POST = await route();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = testDb.current;
    testDb.current = {
      select: () => {
        throw new Error("connection refused");
      },
    };
    try {
      const response = await POST(signed(sessionEvent({ leagueId: "l1", userId: alice, kind: SEASON_PASS })));
      expect(response.status).toBe(500);
      expect(error.mock.calls[0][0]).toMatch(/^\[server-error\]/);
    } finally {
      testDb.current = saved;
    }
  });
});
