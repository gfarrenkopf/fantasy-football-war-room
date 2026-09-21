import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { grantEntitlement, SEASON_PASS } from "../entitlements";
import { createTestLeague } from "../testLeagues";
import { verifyBridgeToken } from "./bridgeTokens";

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

/** The pair route with cloud features and payments configured, no beta allowlist. */
async function route(env: Record<string, string> = {}) {
  const vars = {
    DATABASE_URL: "postgres://localhost/unused",
    NEXTAUTH_SECRET: "secret",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_ID: "price_x",
    ESPN_SYNC_ALLOWLIST: "",
    ...env,
  };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return import("@/app/api/espn/pair/route");
}

const pair = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/espn/pair", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", origin },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

describe("POST /api/espn/pair", () => {
  let userId: string;
  let leagueId: string;
  const body = () => ({ leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });

  beforeEach(async () => {
    vi.resetModules();
    userId = await createTestUser(db, `${crypto.randomUUID()}@example.test`);
    leagueId = await createTestLeague(db, userId);
    state.user = { userId, email: "fan@example.test" };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("mints a token scoped to the league once it has a season pass", async () => {
    const { POST } = await route();
    await grantEntitlement(db, { leagueId, userId, kind: SEASON_PASS, source: "cs_test", amountTotal: 999, currency: "usd" });
    const res = await POST(pair(body()), ctx);
    expect(res.status).toBe(200);
    const { token, expiresAt } = await res.json();
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    expect(await verifyBridgeToken(db, token)).toMatchObject({ userId, leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });
  });

  it("asks for a season pass when the league has none", async () => {
    const { POST } = await route();
    const res = await POST(pair(body()), ctx);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ needsPurchase: true });
  });

  it("limits the beta to the allowlist, season pass or not", async () => {
    const { POST } = await route({ ESPN_SYNC_ALLOWLIST: "owner@example.test" });
    await grantEntitlement(db, { leagueId, userId, kind: SEASON_PASS, source: "cs_test", amountTotal: 999, currency: "usd" });
    expect((await POST(pair(body()), ctx)).status).toBe(403);
    state.user = { userId, email: "owner@example.test" };
    expect((await POST(pair(body()), ctx)).status).toBe(200);
  });

  it("refuses someone else's league", async () => {
    const { POST } = await route();
    const other = await createTestLeague(db, await createTestUser(db));
    expect((await POST(pair({ ...body(), leagueId: other }), ctx)).status).toBe(404);
  });

  it("validates the request", async () => {
    const { POST } = await route();
    for (const bad of [{}, { ...body(), espnLeagueId: "abc" }, { ...body(), espnTeamId: 0 }, { ...body(), season: 1999 }]) {
      expect((await POST(pair(bad), ctx)).status).toBe(400);
    }
  });

  it("rejects cross-site requests, signed-out users, and everything when cloud features are off", async () => {
    const { POST } = await route();
    expect((await POST(pair(body(), "https://fantasy.espn.com"), ctx)).status).toBe(403);
    state.user = null;
    expect((await POST(pair(body()), ctx)).status).toBe(401);
    vi.resetModules();
    const off = await route({ DATABASE_URL: "" });
    expect((await off.POST(pair(body()), ctx)).status).toBe(404);
  });
});
