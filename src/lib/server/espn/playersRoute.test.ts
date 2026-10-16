import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { createTestLeague } from "../testLeagues";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  load: null as unknown,
  searched: [] as unknown[],
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/waivers", () => ({
  searchPlayers: async (_db: unknown, _key: unknown, _userId: unknown, _leagueId: unknown, search: unknown) => {
    state.searched.push(search);
    return state.load;
  },
}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

async function route(env: Record<string, string> = {}) {
  vi.resetModules();
  const vars = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "", SEASON_ACCESS: "", SEASON_ALLOWLIST: "", ...env };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return (await import("@/app/api/leagues/[id]/season/players/route")).GET;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, query = "") => new Request(`http://localhost/api/leagues/${id}/season/players${query}`);
const PICKUP = { player: { playerId: 7, name: "Tyler Bass" }, delta: 3, perWeek: 1, drop: null };
const ROSTERED = { player: { playerId: 8, name: "Brandon Aubrey" }, teamId: 3, team: "Gridiron Gang", mine: false };

describe("GET /api/leagues/:id/season/players", () => {
  let userId: string;
  let leagueId: string;
  beforeEach(async () => {
    state.load = { kind: "ok", players: [PICKUP], rostered: [ROSTERED], more: true, fetchedAt: new Date("2026-10-16T15:00:00Z") };
    state.searched = [];
    userId = await createTestUser(db);
    state.user = { userId, email: "fan@example.test" };
    leagueId = await createTestLeague(db, userId);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers a page of the pool for the search", async () => {
    const res = await (await route())(get(leagueId, "?q=bass&pos=K&refresh=1"), ctx(leagueId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ players: [PICKUP], rostered: [ROSTERED], more: true, fetchedAt: "2026-10-16T15:00:00.000Z" });
    expect(state.searched).toEqual([{ name: "bass", position: "K", offset: 0, refresh: true }]);
  });

  it("404s with in-season help off and for someone else's league, 403s off the allowlist, 400s a bad search", async () => {
    expect((await (await route({ ESPN_CODE_KEY: "" }))(get(leagueId), ctx(leagueId))).status).toBe(404);
    expect((await (await route({ SEASON_ACCESS: "closed", SEASON_ALLOWLIST: "someone@else.test" }))(get(leagueId), ctx(leagueId))).status).toBe(403);
    const other = await createTestLeague(db, await createTestUser(db));
    expect((await (await route())(get(other), ctx(other))).status).toBe(404);
    expect((await (await route())(get(leagueId, "?pos=FLEX"), ctx(leagueId))).status).toBe(400);
  });

  it("answers 409 with the problem when ESPN can't be read, and 503 when the read throws", async () => {
    state.load = { kind: "problem", problem: "no-login" };
    const refused = await (await route())(get(leagueId), ctx(leagueId));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ problem: "no-login" });

    state.load = Promise.reject(new Error("boom"));
    (state.load as Promise<unknown>).catch(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await (await route())(get(leagueId), ctx(leagueId))).status).toBe(503);
  });
});
