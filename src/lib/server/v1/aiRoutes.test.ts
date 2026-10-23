import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "@/lib/ai/provider";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { grantEntitlement, SEASON_PASS } from "../entitlements";
import { claimSeasonAiUse, startTrial, trialStartWeek, usedSeasonAi } from "../seasonAi";
import { createTestLeague } from "../testLeagues";
import { AI_LOCKED, STALE_LINEUP, type AiResponse, type AiWriteupView } from "./ai";

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
        ? { lean: "counter", summary: "Close, but ask for more.", reasons: ["You lose depth."], counter: { give: [], get: [], note: "" } }
        : request.user.includes("## Candidates")
          ? { safe: { pick: "s1", why: "Fills your WR hole.", pitch: "A back for a wideout?" }, bold: { pick: "", why: "", pitch: "" } }
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
/** Opposite holes, so the search finds trades that help both sides. */
const ideasView = seasonView(
  [player("QB A", "QB", 20), player("RB A", "RB", 18), player("RB B", "RB", 16), player("RB C", "RB", 12), player("RB D", "RB", 10), player("WR A", "WR", 14), player("WR B", "WR", 4), player("TE A", "TE", 8)],
  [player("QB B", "QB", 18), player("RB E", "RB", 15), player("RB F", "RB", 3), player("WR C", "WR", 17), player("WR D", "WR", 15), player("WR E", "WR", 12), player("WR F", "WR", 9), player("TE B", "TE", 7)],
);

async function routes(env: Record<string, string> = {}) {
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
    ...env,
  };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const ai = await import("@/app/api/v1/leagues/[id]/ai/route");
  const lineup = await import("@/app/api/v1/leagues/[id]/ai/lineup/route");
  const trade = await import("@/app/api/v1/leagues/[id]/ai/trade/route");
  const ideas = await import("@/app/api/v1/leagues/[id]/ai/trade-ideas/route");
  return { get: ai.GET, lineup: lineup.POST, trade: trade.POST, ideas: ideas.POST };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (id: string, path = "") => `http://localhost/api/v1/leagues/${id}/ai${path}`;
const get = (id: string) => new Request(url(id));
const post = (id: string, path: string, body?: unknown) =>
  new Request(url(id, path), { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });

describe("/api/v1 in-season AI routes", () => {
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

  it("reads the trial before any AI use, with a lineup to write and trades to find", async () => {
    const { get: read } = await routes();
    const res = await read(get(leagueId), ctx(leagueId));
    expect(res.status).toBe(200);
    expect((await res.json()) satisfies AiResponse).toEqual({
      access: { state: "trial", trialWeek: 1, trialWeeks: 5, note: "Free trial · week 1 of 5" },
      week: 5,
      lineup: null,
      lineupAction: "write",
      lineupNote: null,
      ideas: null,
      canFindIdeas: true,
    });
    expect(await trialStartWeek(db, userId, 2026)).toBeNull();
  });

  it("writes the AI lineup, answers with the new state, and serves the same one again for free", async () => {
    const { lineup, get: read } = await routes();
    const first = await lineup(post(leagueId, "/lineup"), ctx(leagueId));
    expect(first.status).toBe(200);
    const body = (await first.json()) as AiResponse;
    expect(body.lineup).toMatchObject({ intro: "Set it and forget it.", departures: null, espn: { matches: false, text: "Not on ESPN yet: Bench at FLEX." } });
    // ESPN has nobody at FLEX; the AI starts the bench back there.
    expect(body.lineup?.starters.find((s) => s.key === "FLEX")?.playerId).toBe(mine[3].playerId);
    expect(body.lineupAction).toBeNull(); // the mid-week allowance is used now
    expect(await trialStartWeek(db, userId, 2026)).toBe(5);

    expect((await lineup(post(leagueId, "/lineup"), ctx(leagueId))).status).toBe(200);
    expect(state.calls).toHaveLength(1);
    expect(((await (await read(get(leagueId), ctx(leagueId))).json()) as AiResponse).lineup?.intro).toBe("Set it and forget it.");
  });

  it("marks a lineup stale once the projections move under it, and rewrites it for free (APE-439)", async () => {
    const { lineup, get: read } = await routes();
    await lineup(post(leagueId, "/lineup"), ctx(leagueId));
    // RB1 started in it; ESPN now projects him for nothing although his team plays, and the lineup fills without him.
    const game = { state: "pre", detail: "", opponent: "GB", home: true, kickoff: null } as never;
    const spares = [player("Spare WR1", "WR", 3), player("Spare WR2", "WR", 2), player("Spare WR3", "WR", 1), player("Spare TE", "TE", 2)];
    state.view = seasonView([...mine.map((p) => (p.name === "RB1" ? { ...p, points: 0, game } : p)), ...spares], theirs);
    const stale = (await (await read(get(leagueId), ctx(leagueId))).json()) as AiResponse;
    expect(stale.lineup).toMatchObject({ stale: true, espn: { matches: false, text: STALE_LINEUP } });
    expect(stale.lineup?.starters.some((s) => s.playerId === mine[1].playerId)).toBe(false);
    expect(stale.lineupAction).toBe("rewrite"); // although the mid-week allowance is used

    const rewritten = (await (await lineup(post(leagueId, "/lineup"), ctx(leagueId))).json()) as AiResponse;
    expect(rewritten.lineup?.stale).toBe(false);
    expect(rewritten.lineupAction).toBeNull();
    expect(state.calls).toHaveLength(2);
    expect(await usedSeasonAi(db, leagueId, 2026, 5)).toEqual(["lineup-midweek"]);
  });

  it("says when the mid-week lineup went without a stored one", async () => {
    const { get: read, lineup } = await routes();
    await claimSeasonAiUse(db, { leagueId, season: 2026, week: 5, kind: "lineup-midweek" });
    const body = (await (await read(get(leagueId), ctx(leagueId))).json()) as AiResponse;
    expect(body).toMatchObject({ lineup: null, lineupAction: null, lineupNote: expect.stringContaining("The Sunday one comes after the inactives") });
    const used = await lineup(post(leagueId, "/lineup"), ctx(leagueId));
    expect(used.status).toBe(409);
    expect(await used.json()).toMatchObject({ used: true });
  });

  it("locks a league past the trial without a word about buying, and unlocks it with a pass", async () => {
    const { get: read, lineup, trade, ideas } = await routes();
    await startTrial(db, userId, 2026, 1);
    state.view = { ...view, currentWeek: 6 };

    const body = (await (await read(get(leagueId), ctx(leagueId))).json()) as AiResponse;
    expect(body).toMatchObject({ access: { state: "locked", note: AI_LOCKED }, lineup: null, lineupAction: null, canFindIdeas: false });
    for (const res of [
      await lineup(post(leagueId, "/lineup"), ctx(leagueId)),
      await ideas(post(leagueId, "/trade-ideas"), ctx(leagueId)),
      await trade(post(leagueId, "/trade", { partner: 2, gives: [mine[3].playerId], gets: [theirs[1].playerId] }), ctx(leagueId)),
    ]) {
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({ error: AI_LOCKED, locked: true });
    }
    expect(JSON.stringify(body)).not.toMatch(/checkout|stripe|\$|price/i);
    expect(state.calls).toHaveLength(0);

    await grantEntitlement(db, { leagueId, userId, kind: SEASON_PASS, source: "cs_test", amountTotal: 999, currency: "usd" });
    expect(((await (await read(get(leagueId), ctx(leagueId))).json()) as AiResponse).access).toEqual({ state: "unlocked" });
    expect((await lineup(post(leagueId, "/lineup"), ctx(leagueId))).status).toBe(200);
  });

  it("lets an AI_ALLOWLIST account past the trial", async () => {
    const { get: read } = await routes({ AI_ALLOWLIST: "fan@example.test" });
    await startTrial(db, userId, 2026, 1);
    state.view = { ...view, currentWeek: 6 };
    expect(((await (await read(get(leagueId), ctx(leagueId))).json()) as AiResponse).access).toEqual({ state: "unlocked" });
  });

  it("shows no AI to an account that isn't allowed it, or when AI is off", async () => {
    const off = await routes({ STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", STRIPE_PRICE_ID: "", AI_ALLOWLIST: "someone@else.test" });
    expect((await off.get(get(leagueId), ctx(leagueId))).status).toBe(403);
    expect((await off.lineup(post(leagueId, "/lineup"), ctx(leagueId))).status).toBe(403);

    vi.resetModules();
    const noModel = await routes({ ANTHROPIC_API_KEY: "" });
    expect((await noModel.get(get(leagueId), ctx(leagueId))).status).toBe(404);
  });

  it("finds trade ideas and grades them against the rosters now", async () => {
    const { ideas, get: read } = await routes();
    state.view = ideasView;
    const res = await ideas(post(leagueId, "/trade-ideas"), ctx(leagueId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiResponse;
    expect(body.canFindIdeas).toBe(false);
    expect(body.ideas?.missing).toEqual(["No bolder swing this week that a partner would plausibly take."]);
    const [idea] = body.ideas!.ideas;
    expect(idea).toMatchObject({ kind: "safe", label: "Win-win", status: "ok", note: null, moved: null, why: "Fills your WR hole.", pitch: "A back for a wideout?", canOffer: true });
    expect(idea.grade?.perWeek).toBeGreaterThan(0);
    expect(idea.gives.every((p) => p.name.length > 0)).toBe(true);

    // A player leaves the partner's roster: the idea has passed.
    const gone = idea.gets[0].id;
    state.view = { ...ideasView, teams: ideasView.teams.map((t) => ({ ...t, roster: t.roster.filter((p) => p.playerId !== gone) })) };
    const later = ((await (await read(get(leagueId), ctx(leagueId))).json()) as AiResponse).ideas!.ideas[0];
    expect(later).toMatchObject({ status: "stale", grade: null, canOffer: false, note: expect.stringContaining("so this one has passed") });
    expect(state.calls).toHaveLength(1);
  });

  it("answers none with the state when no trade clears the bar, and refuses after the deadline", async () => {
    const { ideas } = await routes();
    const none = await ideas(post(leagueId, "/trade-ideas"), ctx(leagueId));
    expect(none.status).toBe(200);
    expect(await none.json()).toMatchObject({ none: true, ideas: null, canFindIdeas: true });
    expect(await usedSeasonAi(db, leagueId, 2026, 5)).toEqual([]);

    state.view = { ...ideasView, tradeDeadlinePassed: true };
    const late = await ideas(post(leagueId, "/trade-ideas"), ctx(leagueId));
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ deadline: true });
  });

  it("writes up a trade with names, and refuses one that isn't the user's", async () => {
    const { trade } = await routes();
    const ok = await trade(post(leagueId, "/trade", { partner: 2, gives: [mine[3].playerId], gets: [theirs[1].playerId] }), ctx(leagueId));
    expect(ok.status).toBe(200);
    expect((await ok.json()) satisfies AiWriteupView).toMatchObject({ lean: "counter", leanLabel: "Counter", summary: "Close, but ask for more.", reasons: ["You lose depth."], counter: null });
    expect((await trade(post(leagueId, "/trade", { partner: 1, gives: [], gets: [] }), ctx(leagueId))).status).toBe(422);
    expect((await trade(post(leagueId, "/trade", { partner: 2, gives: "all" }), ctx(leagueId))).status).toBe(400);
  });

  it("won't read or write another account's league", async () => {
    const { get: read, lineup } = await routes();
    const other = await createTestLeague(db, await createTestUser(db));
    expect((await read(get(other), ctx(other))).status).toBe(404);
    expect((await lineup(post(other, "/lineup"), ctx(other))).status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });
});
