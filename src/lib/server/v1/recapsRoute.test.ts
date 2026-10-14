import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { GameState } from "@/lib/season/scoreboard";
import type { SeasonView } from "@/lib/season/view";
import { saveWeek } from "../seasonRecaps";
import { createTestLeague } from "../testLeagues";
import type { RecapResponse, RecapsResponse } from "./recaps";

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

const ENV = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "" };

async function routes(env: Partial<typeof ENV> = {}) {
  for (const [name, value] of Object.entries({ ...ENV, ...env })) vi.stubEnv(name, value);
  return {
    list: (await import("@/app/api/v1/leagues/[id]/recaps/route")).GET,
    one: (await import("@/app/api/v1/leagues/[id]/recaps/[week]/route")).GET,
  };
}

const post: GameState = { state: "post", detail: "", opponent: "NYJ", home: true, kickoff: null, period: 4, clockSeconds: 0, score: null };

/** A finished week: the user's QB scoring `scored` against the other team's QB's 12. */
function week(season: number, w: number, scored: number): SeasonView {
  const qb = at("QB", player("Josh Allen", "QB", 19, { playerId: 1, game: post, actual: scored }));
  const theirs = at("QB", player("Their QB", "QB", 18, { playerId: 3, game: post, actual: 12 }));
  const view = seasonView([qb], [theirs]);
  const sides = {
    home: { teamId: 1, points: scored, projected: 19, winProbability: null },
    away: { teamId: 2, points: 12, projected: 18, winProbability: null },
  };
  return { ...view, season, currentWeek: w, matchups: [sides], matchup: { me: sides.home, them: sides.away } };
}

const listCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const oneCtx = (id: string, w: string) => ({ params: Promise.resolve({ id, week: w }) });
const get = (path: string) => new Request(`http://localhost/api/v1/leagues/${path}`);

describe("GET /api/v1/leagues/:id/recaps", () => {
  let userId: string;
  let leagueId: string;
  beforeEach(async () => {
    vi.resetModules();
    userId = await createTestUser(db);
    state.user = { userId, email: "fan@example.test" };
    leagueId = await createTestLeague(db, userId, "Sunday League");
    await saveWeek(db, leagueId, week(2025, 14, 30), { settle: true, now: new Date("2025-12-10T14:00:00Z") });
    await saveWeek(db, leagueId, week(2026, 1, 25), { settle: true, now: new Date("2026-09-16T14:00:00Z") });
    await saveWeek(db, leagueId, week(2026, 2, 10), { now: new Date("2026-09-22T03:00:00Z") });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lists every kept week, newest first, with its headline and the user's result", async () => {
    const { list } = await routes();
    const res = await list(get(`${leagueId}/recaps`), listCtx(leagueId));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as RecapsResponse;
    expect(body.league).toEqual({ id: leagueId, name: "Sunday League" });
    expect(body.seasons).toEqual([2026, 2025]);
    expect(body.weeks.map((w) => [w.season, w.week])).toEqual([
      [2026, 2],
      [2026, 1],
      [2025, 14],
    ]);
    expect(body.weeks[0]).toEqual({
      season: 2026,
      week: 2,
      headline: "Brutal. Theirs got you by 2.0.",
      mine: { result: "loss", me: 10, them: 12, opponent: "Theirs" },
      date: "2026-09-22T03:00:00.000Z",
      settled: false,
    });
    expect(body.weeks[1]).toMatchObject({ headline: "A 13.0-point win over Theirs.", mine: { result: "win" }, date: "2026-09-16T14:00:00.000Z", settled: true });
  });

  it("is empty before any week is kept", async () => {
    const empty = await createTestLeague(db, userId);
    const { list } = await routes();
    expect(await (await list(get(`${empty}/recaps`), listCtx(empty))).json()).toEqual({ league: { id: empty, name: "Home league" }, seasons: [], weeks: [] });
  });

  it("returns one week as the archive tells it, with what the recap card draws", async () => {
    const { one } = await routes();
    const res = await one(get(`${leagueId}/recaps/1`), oneCtx(leagueId, "1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecapResponse;
    expect(body).toMatchObject({ league: { id: leagueId, name: "Sunday League" }, season: 2026, week: 1, settled: true, headline: "A 13.0-point win over Theirs." });
    expect(Object.keys(body.recap).sort()).toEqual(
      ["benchwarmers", "falseStarters", "gameChanger", "headline", "mine", "standings", "story", "topScorers", "week"].sort(),
    );
    expect(body.recap.story).toMatch(/^A 13\.0-point win over Theirs\. Josh Allen/);
    expect(body.swing).toMatchObject({ final: 13 });
    expect(body.card).toMatchObject({ week: 1, result: "win", me: 25, them: 12, margin: 13, opponent: "Theirs" });
    expect(body.card?.starters.map((p) => [p.slot, p.playerId, p.points, p.projected])).toEqual([["QB", 1, 25, 19]]);
    expect(body.card?.star).toMatchObject({ player: { playerId: 1 }, beat: true });
  });

  it("reads an older season's week when asked", async () => {
    const { one } = await routes();
    const body = (await (await one(get(`${leagueId}/recaps/14?season=2025`), oneCtx(leagueId, "14"))).json()) as RecapResponse;
    expect(body).toMatchObject({ season: 2025, week: 14, mine: { result: "win", me: 30 } });
  });

  it("answers 404 for a week that isn't kept, and 400 for one that isn't a week", async () => {
    const { one } = await routes();
    expect((await one(get(`${leagueId}/recaps/14`), oneCtx(leagueId, "14"))).status).toBe(404);
    expect((await one(get(`${leagueId}/recaps/1?season=2024`), oneCtx(leagueId, "1"))).status).toBe(404);
    const empty = await createTestLeague(db, userId);
    expect((await one(get(`${empty}/recaps/1`), oneCtx(empty, "1"))).status).toBe(404);
    expect((await one(get(`${leagueId}/recaps/first`), oneCtx(leagueId, "first"))).status).toBe(400);
    expect((await one(get(`${leagueId}/recaps/0`), oneCtx(leagueId, "0"))).status).toBe(400);
    expect((await one(get(`${leagueId}/recaps/1?season=last`), oneCtx(leagueId, "1"))).status).toBe(400);
  });

  it("is gated like the season route", async () => {
    const check = async (env: Partial<typeof ENV>, status: number) => {
      vi.unstubAllEnvs();
      vi.resetModules();
      const { list, one } = await routes(env);
      expect((await list(get(`${leagueId}/recaps`), listCtx(leagueId))).status).toBe(status);
      expect((await one(get(`${leagueId}/recaps/1`), oneCtx(leagueId, "1"))).status).toBe(status);
    };
    await check({ DATABASE_URL: "" }, 404);
    await check({ ESPN_CODE_KEY: "" }, 404);
    await check({ ESPN_SYNC_ALLOWLIST: "someone@else.test" }, 403);

    vi.unstubAllEnvs();
    vi.resetModules();
    const { list, one } = await routes();
    expect((await list(get("not-mine/recaps"), listCtx("not-mine"))).status).toBe(404);
    expect((await one(get("not-mine/recaps/1"), oneCtx("not-mine", "1"))).status).toBe(404);
    const someoneElse = await createTestLeague(db, await createTestUser(db));
    await saveWeek(db, someoneElse, week(2026, 1, 25));
    expect((await one(get(`${someoneElse}/recaps/1`), oneCtx(someoneElse, "1"))).status).toBe(404);
    state.user = null;
    expect((await list(get(`${leagueId}/recaps`), listCtx(leagueId))).status).toBe(401);
    expect((await one(get(`${leagueId}/recaps/1`), oneCtx(leagueId, "1"))).status).toBe(401);
  });
});
