import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { parseEspnPlayers } from "@/lib/espn/crosswalk";
import { ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import espnPool from "@/lib/espn/__fixtures__/espn-players-2026.json";
import { connectEspn, getDraft, putDraft } from "../leagues";
import { createTestLeague } from "../testLeagues";
import { storeLogin } from "./logins";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ db: null as unknown, user: null as { userId: string; email: string | null } | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/players", () => ({ getEspnPlayers: async () => parseEspnPlayers(espnPool) }));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const KEY = Buffer.alloc(32, 7);
const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";
const TOTAL = 12 * 16; // createTestLeague: 12 teams, standard 16-slot roster
const finished = { draftDetail: { drafted: true, inProgress: false, picks: Array.from({ length: TOTAL }, (_, i) => ({ overallPickNumber: i + 1, teamId: (i % 12) + 1, playerId: 1000 + i })) } };

async function route(env: Record<string, string> = {}) {
  const vars = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: KEY.toString("base64"), ESPN_SYNC_ALLOWLIST: "", ...env };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return import("@/app/api/leagues/[id]/espn/reconcile/route");
}

const post = (leagueId: string) => [
  new Request(`http://localhost/api/leagues/${leagueId}/espn/reconcile`, { method: "POST", headers: { host: "localhost", origin: "http://localhost" } }),
  { params: Promise.resolve({ id: leagueId }) },
] as const;

describe("POST /api/leagues/:id/espn/reconcile (APE-325)", () => {
  let userId: string;
  let leagueId: string;

  beforeEach(async () => {
    vi.resetModules();
    delete (globalThis as { __espnReconciled?: unknown }).__espnReconciled;
    userId = await createTestUser(db);
    leagueId = await createTestLeague(db, userId);
    state.user = { userId, email: "fan@example.test" };
    await connectEspn(db, userId, leagueId, { espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks for a season connection without a login", async () => {
    const { POST } = await route();
    const res = await POST(...post(leagueId));
    expect(await res.json()).toEqual({ result: { kind: "no-login" } });
  });

  it("replaces the board with ESPN's finished draft and locks it, reading ESPN at most once in a while", async () => {
    const { POST } = await route();
    await storeLogin(db, KEY, userId, { espnS2: "s2", swid: SWID }, { season: 2026, consentVersion: ESPN_DISCLOSURE_VERSION });
    await putDraft(db, userId, leagueId, { version: 1, picks: [{ playerId: "ja-marr-chase-wr", mine: true }] }, 0);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(finished)));
    vi.stubGlobal("fetch", fetchImpl);

    expect(await (await POST(...post(leagueId))).json()).toEqual({ result: { kind: "imported" } });
    const { state: saved } = (await getDraft(db, userId, leagueId))!;
    expect(saved!.final).toMatchObject({ source: "espn" });
    expect(saved!.picks).toHaveLength(TOTAL);

    expect(await (await POST(...post(leagueId))).json()).toEqual({ result: { kind: "not-finished" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("is 404 for another user's league, and for a league that isn't connected", async () => {
    const { POST } = await route();
    const other = await createTestLeague(db, await createTestUser(db));
    expect((await POST(...post(other))).status).toBe(404);
    const plain = await createTestLeague(db, userId);
    expect((await POST(...post(plain))).status).toBe(404);
  });
});
