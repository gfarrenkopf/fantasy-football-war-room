import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "@/lib/ai/provider";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { grantEntitlement, SEASON_PASS } from "./entitlements";
import { startTrial, trialStartWeek, usedSeasonAi } from "./seasonAi";
import { createTestLeague } from "./testLeagues";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  view: null as unknown,
  calls: [] as ModelRequest[],
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/seasonView", () => ({
  loadSeasonView: async () => ({ kind: "ok", view: state.view, fetchedAt: new Date(), stale: false, projectionsMissing: false }),
}));
vi.mock("@/lib/ai/providers", () => ({
  isPlanProvider: () => true,
  createPlanModel: () => ({
    provider: "fake",
    model: "fake-1",
    async generate(request: ModelRequest) {
      state.calls.push(request);
      const json = request.user.includes("The trade:")
        ? { lean: "accept", summary: "Take it.", reasons: [], counter: { give: [], get: [], note: "" } }
        : { intro: "Set it and forget it.", calls: [] };
      return { json, usage: { inputTokens: 500, outputTokens: 100 } };
    },
  }),
}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const mine = [at("QB", player("QB", "QB", 20)), at("RB", player("RB1", "RB", 15)), at("RB", player("RB2", "RB", 12)), player("Bench", "RB", 4)];
const theirs = [at("QB", player("Their QB", "QB", 18)), player("Their Bench", "WR", 6)];
const view = seasonView(mine, theirs); // week 5

async function routes() {
  const vars = {
    DATABASE_URL: "postgres://localhost/unused",
    NEXTAUTH_SECRET: "secret",
    ANTHROPIC_API_KEY: "sk-ant-test",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_ID: "price_x",
    ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"),
    ESPN_SYNC_ALLOWLIST: "",
    AI_ALLOWLIST: "",
  };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const lineup = await import("@/app/api/leagues/[id]/season/lineup/route");
  const trade = await import("@/app/api/leagues/[id]/season/trade/route");
  return { lineup: lineup.POST, trade: trade.POST };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const lineupPost = (id: string) => new Request(`http://localhost/api/leagues/${id}/season/lineup`, { method: "POST" });
const tradePost = (id: string, body: unknown) =>
  new Request(`http://localhost/api/leagues/${id}/season/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("in-season AI routes", () => {
  let userId: string;
  let leagueId: string;
  beforeEach(async () => {
    vi.resetModules();
    state.calls = [];
    state.view = view;
    userId = await createTestUser(db);
    state.user = { userId, email: "fan@example.test" };
    leagueId = await createTestLeague(db, userId);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("writes the first AI lineup in the trial, starts the trial, and serves the same one again for free", async () => {
    const { lineup } = await routes();
    const first = await lineup(lineupPost(leagueId), ctx(leagueId));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ lineup: { intro: "Set it and forget it." } });
    expect(await trialStartWeek(db, userId, 2026)).toBe(5);
    expect(await usedSeasonAi(db, leagueId, 2026, 5)).toEqual(["lineup-midweek"]);

    expect((await lineup(lineupPost(leagueId), ctx(leagueId))).status).toBe(200);
    expect(state.calls).toHaveLength(1);
  });

  it("paywalls a league without a pass after the trial, but not a paid one", async () => {
    const { lineup, trade } = await routes();
    await startTrial(db, userId, 2026, 1); // week 5 is the 5th week: still free
    expect((await lineup(lineupPost(leagueId), ctx(leagueId))).status).toBe(200);

    state.view = { ...view, currentWeek: 6 }; // the 6th week
    const walled = await lineup(lineupPost(leagueId), ctx(leagueId));
    expect(walled.status).toBe(402);
    expect(await walled.json()).toEqual({ needsPurchase: true });
    expect((await trade(tradePost(leagueId, { partner: 2, gives: [mine[3].playerId], gets: [theirs[1].playerId] }), ctx(leagueId))).status).toBe(402);

    await grantEntitlement(db, { leagueId, userId, kind: SEASON_PASS, source: "cs_test", amountTotal: 999, currency: "usd" });
    expect((await lineup(lineupPost(leagueId), ctx(leagueId))).status).toBe(200);
  });

  it("writes a trade write-up, and refuses a trade that isn't the user's", async () => {
    const { trade } = await routes();
    const ok = await trade(tradePost(leagueId, { partner: 2, gives: [mine[3].playerId], gets: [theirs[1].playerId] }), ctx(leagueId));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ writeup: { lean: "accept", counter: null } });
    expect((await trade(tradePost(leagueId, { partner: 1, gives: [], gets: [] }), ctx(leagueId))).status).toBe(422);
    expect((await trade(tradePost(leagueId, { partner: 2, gives: "all" }), ctx(leagueId))).status).toBe(400);
  });

  it("won't write for someone else's league", async () => {
    const { lineup } = await routes();
    const other = await createTestLeague(db, await createTestUser(db));
    expect((await lineup(lineupPost(other), ctx(other))).status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });
});
