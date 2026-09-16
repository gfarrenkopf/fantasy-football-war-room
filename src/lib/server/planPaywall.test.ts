import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NEEDS_PURCHASE, NO_PLAN } from "@/lib/ai/planView";
import { aiPlans } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { grantEntitlement, SEASON_PASS } from "./entitlements";
import { createTestLeague } from "./testLeagues";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ db: null as unknown, user: null as { userId: string; email: string | null } | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

/** The plan route with AI plans and payments fully configured. */
async function route(env: Record<string, string> = {}) {
  const vars = {
    DATABASE_URL: "postgres://localhost/unused",
    NEXTAUTH_SECRET: "secret",
    ANTHROPIC_API_KEY: "sk-ant-test",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_ID: "price_x",
    AI_ALLOWLIST: "",
    ...env,
  };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return import("@/app/api/leagues/[id]/plan/route");
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => new Request(`http://localhost/api/leagues/${id}/plan`);
const post = (id: string) => new Request(`http://localhost/api/leagues/${id}/plan`, { method: "POST" });

describe("AI plan paywall", () => {
  let userId: string;
  beforeEach(async () => {
    vi.resetModules();
    userId = await createTestUser(db, `${crypto.randomUUID()}@example.test`);
    state.user = { userId, email: "buyer@example.test" };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows a league without a season pass the paywall, and refuses to write a plan", async () => {
    const { GET, POST } = await route();
    const leagueId = await createTestLeague(db, userId);

    const read = await GET(get(leagueId), ctx(leagueId));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(NEEDS_PURCHASE);

    const request = await POST(post(leagueId), ctx(leagueId));
    expect(request.status).toBe(402);
    expect(await request.json()).toEqual(NEEDS_PURCHASE);
    expect((await db.select().from(aiPlans)).filter((row) => row.leagueId === leagueId)).toEqual([]);
  });

  it("lifts the paywall once the league has a season pass", async () => {
    const { GET } = await route();
    const leagueId = await createTestLeague(db, userId);
    await grantEntitlement(db, { leagueId, userId, kind: SEASON_PASS, source: "cs_test", amountTotal: 999, currency: "usd" });
    const read = await GET(get(leagueId), ctx(leagueId));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(NO_PLAN);
  });

  it("lets allowlisted accounts skip the paywall", async () => {
    const { GET } = await route({ AI_ALLOWLIST: "buyer@example.test" });
    const leagueId = await createTestLeague(db, userId);
    expect(await (await GET(get(leagueId), ctx(leagueId))).json()).toEqual(NO_PLAN);
  });

  it("doesn't reveal whether someone else's league has paid", async () => {
    const { GET, POST } = await route();
    const other = await createTestUser(db);
    const leagueId = await createTestLeague(db, other);
    expect((await GET(get(leagueId), ctx(leagueId))).status).toBe(404);
    expect((await POST(post(leagueId), ctx(leagueId))).status).toBe(404);
  });

  it("with payments off, gates nothing (self-hosted)", async () => {
    const { GET } = await route({ STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", STRIPE_PRICE_ID: "" });
    const leagueId = await createTestLeague(db, userId);
    expect(await (await GET(get(leagueId), ctx(leagueId))).json()).toEqual(NO_PLAN);
  });
});
