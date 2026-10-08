import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { createTestLeague } from "../testLeagues";
import { mintBridgeToken } from "./bridgeTokens";
import { acknowledgeDisclosure } from "./disclosure";
import type { ConnectRequest, ConnectResult } from "./seasonConnect";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  connects: [] as { userId: string; req: ConnectRequest }[],
  result: null as unknown,
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/server/espn/seasonConnect", () => ({
  connectSeason: async (_db: unknown, _key: unknown, userId: string, req: ConnectRequest) => {
    state.connects.push({ userId, req });
    return state.result;
  },
}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const KEY = randomBytes(32);
const ESPN = "https://fantasy.espn.com";
const LOGIN = { espnS2: "AEB-not-a-real-espn-s2-cookie-%2F%3D", swid: "{154E132F-8C13-4AC0-9DAC-20C2C5625594}" };

async function route(env: Record<string, string> = {}) {
  const vars = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: KEY.toString("base64"), ESPN_SYNC_ALLOWLIST: "", ...env };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return import("@/app/api/espn/bridge/season/route");
}

const post = (token: string | null, body: unknown = LOGIN) =>
  new Request("http://localhost/api/espn/bridge/season", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ESPN, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe("POST /api/espn/bridge/season (APE-332)", () => {
  let userId: string;
  let token: string;
  beforeEach(async () => {
    vi.resetModules();
    state.connects = [];
    state.result = { ok: true, leagueId: "lg1", espnTeamId: 1, created: false } satisfies ConnectResult;
    userId = await createTestUser(db, "fan@example.test".replace("fan", crypto.randomUUID()));
    const leagueId = await createTestLeague(db, userId);
    ({ token } = await mintBridgeToken(db, { userId, leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 }));
    await acknowledgeDisclosure(db, userId, ESPN_DISCLOSURE_VERSION);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("connects the paired draft's league for the season, as the paired user", async () => {
    const { POST } = await route();
    const res = await POST(post(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ESPN);
    expect(await res.json()).toEqual({ connected: true });
    expect(state.connects).toEqual([{ userId, req: { espnLeagueId: "704343562", season: 2026, consentVersion: ESPN_DISCLOSURE_VERSION, ...LOGIN } }]);
  });

  it("needs the pairing token and a login", async () => {
    const { POST } = await route();
    expect((await POST(post(null))).status).toBe(401);
    expect((await POST(post("not-a-token"))).status).toBe(401);
    expect((await POST(post(token, { swid: "nope" }))).status).toBe(400);
    expect(state.connects).toEqual([]);
  });

  it("skips quietly where in-season help isn't on, or isn't for this account, or wasn't agreed to", async () => {
    let { POST } = await route({ ESPN_CODE_KEY: "" });
    expect(await (await POST(post(token))).json()).toEqual({ connected: false });

    vi.resetModules();
    ({ POST } = await route({ ESPN_SYNC_ALLOWLIST: "someone-else@example.test" }));
    expect(await (await POST(post(token))).json()).toEqual({ connected: false });

    vi.resetModules();
    ({ POST } = await route());
    await acknowledgeDisclosure(db, userId, ESPN_DISCLOSURE_VERSION - 1);
    expect(await (await POST(post(token))).json()).toEqual({ connected: false });
    expect(state.connects).toEqual([]);
  });

  it("asks the bridge to try again when ESPN can't be reached, and otherwise doesn't", async () => {
    const { POST } = await route();
    state.result = { ok: false, status: 503, error: "Couldn't reach ESPN." } satisfies ConnectResult;
    expect((await POST(post(token))).status).toBe(503);
    state.result = { ok: false, status: 403, error: "No team." } satisfies ConnectResult;
    expect(await (await POST(post(token))).json()).toEqual({ connected: false });
  });
});
