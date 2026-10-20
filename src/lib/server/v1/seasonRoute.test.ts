import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import projections from "@/lib/season/__fixtures__/espn-projections-2026.json";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { parseSeasonLeague } from "@/lib/season/espnLeague";
import { parseProjections } from "@/lib/season/projections";
import { buildSeasonView } from "@/lib/season/view";
import { stampSeasonAccess } from "../espn/seasonAccess";
import { agreeToWrites } from "../seasonPrefs";
import { createTestLeague } from "../testLeagues";
import type { SeasonResponse } from "./season";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  load: null as unknown,
  loads: [] as { refresh?: boolean }[],
  after: 0,
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/seasonView", () => ({
  loadSeasonView: async (_db: unknown, _key: unknown, _userId: unknown, _leagueId: unknown, options: { refresh?: boolean }) => {
    state.loads.push(options);
    return state.load;
  },
}));
vi.mock("@/lib/server/espn/seasonVisit", async (original) => ({
  ...(await original<typeof import("@/lib/server/espn/seasonVisit")>()),
  afterSeasonRead: () => void state.after++,
}));

const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const view = buildSeasonView(parsed.league, 1, new Map(parseProjections(projections, 2026).map((p) => [p.id, p])));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const ENV = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "", SEASON_ACCESS: "", SEASON_ALLOWLIST: "" };

async function route(env: Partial<typeof ENV> = {}) {
  for (const [name, value] of Object.entries({ ...ENV, ...env })) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return (await import("@/app/api/v1/leagues/[id]/season/route")).GET;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, query = "") => new Request(`http://localhost/api/v1/leagues/${id}/season${query}`);

describe("GET /api/v1/leagues/:id/season", () => {
  let userId: string;
  let leagueId: string;
  beforeEach(async () => {
    vi.resetModules();
    state.loads = [];
    state.after = 0;
    state.load = { kind: "ok", view, fetchedAt: new Date("2026-09-20T18:00:00Z"), stale: false, projectionsMissing: false, phase: "lineup" };
    userId = await createTestUser(db);
    state.user = { userId, email: "fan@example.test" };
    leagueId = await createTestLeague(db, userId);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns both tabs' data, derived on the server", async () => {
    const GET = await route();
    const res = await GET(get(leagueId), ctx(leagueId));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as SeasonResponse;
    expect(body).toMatchObject({
      league: { id: leagueId },
      fetchedAt: "2026-09-20T18:00:00.000Z",
      stale: false,
      phase: "lineup",
      defaultTab: "lineup",
      result: null,
      consent: { version: ESPN_WRITE_VERSION, agreed: false },
    });
    expect(body.view.currentWeek).toBe(view.currentWeek);
    expect(body.consent.lines.length).toBeGreaterThan(0);
    expect(Object.keys(body.lineup.eligible).length).toBe(view.teams.find((t) => t.id === view.myTeamId)!.roster.length);
    expect(Object.keys(body.gameDay).sort()).toEqual(
      ["around", "bench", "espnCall", "headToHead", "holes", "lastWeek", "pace", "result", "showArchive", "starters", "trackRecord", "week"].sort(),
    );
    expect(state.loads).toEqual([{ refresh: false }]);
    expect(state.after).toBe(1);
  });

  it("skips the cache on refresh=1, and says once the user has agreed to writes", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const GET = await route();
    const body = (await (await GET(get(leagueId, "?refresh=1"), ctx(leagueId))).json()) as SeasonResponse;
    expect(state.loads).toEqual([{ refresh: true }]);
    expect(body.consent.agreed).toBe(true);
  });

  it("answers 409 with the problem when ESPN can't be read, and still does the visit's background work", async () => {
    state.load = { kind: "disconnected" };
    const GET = await route();
    const res = await GET(get(leagueId), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ problem: "disconnected", error: expect.stringContaining("Reconnect ESPN") });
    expect(state.after).toBe(1);
  });

  it("keeps an account that joined while the beta was open, once it closes (APE-341)", async () => {
    const closed = { SEASON_ACCESS: "closed", SEASON_ALLOWLIST: "someone@else.test" };
    expect((await (await route(closed))(get(leagueId), ctx(leagueId))).status).toBe(403);
    vi.unstubAllEnvs();
    vi.resetModules();
    await stampSeasonAccess(db, userId);
    expect((await (await route(closed))(get(leagueId), ctx(leagueId))).status).toBe(200);
  });

  it("is gated like the season page", async () => {
    expect((await (await route({ DATABASE_URL: "" }))(get(leagueId), ctx(leagueId))).status).toBe(404);
    vi.unstubAllEnvs();
    vi.resetModules();
    expect((await (await route({ ESPN_CODE_KEY: "" }))(get(leagueId), ctx(leagueId))).status).toBe(404);
    vi.unstubAllEnvs();
    vi.resetModules();
    expect((await (await route({ SEASON_ACCESS: "closed", SEASON_ALLOWLIST: "someone@else.test" }))(get(leagueId), ctx(leagueId))).status).toBe(403);
    vi.unstubAllEnvs();
    vi.resetModules();
    // Draft sync's beta list no longer gates in-season help (APE-341).
    expect((await (await route({ ESPN_SYNC_ALLOWLIST: "someone@else.test" }))(get(leagueId), ctx(leagueId))).status).toBe(200);
    state.loads = [];
    vi.unstubAllEnvs();
    vi.resetModules();
    const GET = await route();
    expect((await GET(get("not-mine"), ctx("not-mine"))).status).toBe(404);
    state.user = null;
    expect((await GET(get(leagueId), ctx(leagueId))).status).toBe(401);
    expect(state.loads).toEqual([]);
  });
});
