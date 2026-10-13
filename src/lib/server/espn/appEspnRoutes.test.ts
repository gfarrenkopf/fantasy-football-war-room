import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_DISCLOSURE, ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import { createAppSession } from "../appAuth";
import { hasAcknowledgedDisclosure } from "./disclosure";
import { loginStatus } from "./logins";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => null }));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";
const login = { espnS2: "AEB%2Fnot-a-real-cookie", swid: SWID };
/** ESPN's answer, as in seasonConnect.test.ts: the fixture league, with the user owning team 3. */
const espnLeague = { settings: league.settings, teams: [{ id: 1, owners: ["{AAAAAAAA-0000-0000-0000-000000000000}"] }, { id: 3, owners: [SWID.toLowerCase()] }] };

beforeEach(() => {
  vi.resetModules();
  const vars = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "" };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function bearer() {
  const userId = await createTestUser(db);
  const { token } = await createAppSession(db, userId);
  return { userId, auth: { authorization: `Bearer ${token}` } };
}
const post = (path: string, body: unknown, headers: Record<string, string>) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("GET /api/v1/espn/disclosure", () => {
  it("serves the web's disclosure text and version", async () => {
    const { GET } = await import("@/app/api/v1/espn/disclosure/route");
    expect(await GET().json()).toEqual({ version: ESPN_DISCLOSURE_VERSION, points: [...ESPN_DISCLOSURE] });
  });

  it("is 404 with in-season features off", async () => {
    vi.stubEnv("ESPN_CODE_KEY", "");
    const { GET } = await import("@/app/api/v1/espn/disclosure/route");
    expect(GET().status).toBe(404);
  });
});

describe("POST /api/v1/espn/connect", () => {
  const body = { ...login, espnLeagueId: "110222051", season: 2026, consentVersion: ESPN_DISCLOSURE_VERSION };

  it("connects the season with the captured login and records the consent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(espnLeague)));
    const { POST } = await import("@/app/api/v1/espn/connect/route");
    const { userId, auth } = await bearer();
    const res = await POST(post("/api/v1/espn/connect", body, auth), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: true });
    expect((await loginStatus(db, userId))?.status).toBe("connected");
    expect(await hasAcknowledgedDisclosure(db, userId, ESPN_DISCLOSURE_VERSION)).toBe(true);
  });

  it("passes connectSeason's errors through as written", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ settings: league.settings, teams: [{ id: 1, owners: ["{AAAAAAAA-0000-0000-0000-000000000000}"] }] })));
    const { POST } = await import("@/app/api/v1/espn/connect/route");
    const { userId, auth } = await bearer();
    const res = await POST(post("/api/v1/espn/connect", body, auth), undefined);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have a team in this ESPN league." });
    expect(await loginStatus(db, userId)).toBeNull();
  });

  it("asks for the current disclosure when the app showed an old one", async () => {
    const { POST } = await import("@/app/api/v1/espn/connect/route");
    const { auth } = await bearer();
    const res = await POST(post("/api/v1/espn/connect", { ...body, consentVersion: ESPN_DISCLOSURE_VERSION - 1 }, auth), undefined);
    expect(res.status).toBe(409);
    expect((await res.json()).seasonVersion).toBe(ESPN_DISCLOSURE_VERSION);
  });

  it("rejects a malformed login or league", async () => {
    const { POST } = await import("@/app/api/v1/espn/connect/route");
    const { auth } = await bearer();
    expect((await POST(post("/api/v1/espn/connect", { ...body, swid: "nope" }, auth), undefined)).status).toBe(400);
    expect((await POST(post("/api/v1/espn/connect", { ...body, espnLeagueId: "abc" }, auth), undefined)).status).toBe(400);
  });

  it("keeps the allowlist gate", async () => {
    vi.stubEnv("ESPN_SYNC_ALLOWLIST", "someone-else@example.test");
    const { POST } = await import("@/app/api/v1/espn/connect/route");
    const { auth } = await bearer();
    expect((await POST(post("/api/v1/espn/connect", body, auth), undefined)).status).toBe(403);
  });
});

describe("POST /api/v1/espn/leagues", () => {
  it("lists the login's fantasy football leagues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ preferences: [{ typeId: 9, metaData: { entry: { abbrev: "FFL", seasonId: 2026, entryId: 3, entryMetadata: { teamName: "The Goats" }, groups: [{ groupId: 704343562, groupName: "App Tester" }] } } }] })),
    );
    const { POST } = await import("@/app/api/v1/espn/leagues/route");
    const { auth } = await bearer();
    const res = await POST(post("/api/v1/espn/leagues", login, auth), undefined);
    expect(await res.json()).toEqual({ leagues: [{ espnLeagueId: "704343562", name: "App Tester", season: 2026, espnTeamId: 3, teamName: "The Goats" }] });
  });
});

describe("/api/v1/espn/login", () => {
  it("reports and disconnects the stored login", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(espnLeague)));
    const connect = (await import("@/app/api/v1/espn/connect/route")).POST;
    const { GET, DELETE } = await import("@/app/api/v1/espn/login/route");
    const { auth } = await bearer();
    await connect(post("/api/v1/espn/connect", { ...login, espnLeagueId: "110222051", season: 2026, consentVersion: ESPN_DISCLOSURE_VERSION }, auth), undefined);
    const status = await GET(new Request("http://localhost/api/v1/espn/login", { headers: auth }), undefined);
    expect((await status.json()).login).toMatchObject({ status: "connected", season: 2026 });
    expect((await DELETE(new Request("http://localhost/api/v1/espn/login", { method: "DELETE", headers: auth }), undefined)).status).toBe(204);
    expect((await (await GET(new Request("http://localhost/api/v1/espn/login", { headers: auth }), undefined)).json()).login).toBeNull();
  });
});

describe("GET /api/v1/leagues", () => {
  it("lists the leagues connected for the season", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(espnLeague)));
    const connect = (await import("@/app/api/v1/espn/connect/route")).POST;
    const { GET } = await import("@/app/api/v1/leagues/route");
    const { auth } = await bearer();
    expect(await (await GET(new Request("http://localhost/api/v1/leagues", { headers: auth }), undefined)).json()).toEqual({ leagues: [] });
    const connected = await (await connect(post("/api/v1/espn/connect", { ...login, espnLeagueId: "110222051", season: 2026, consentVersion: ESPN_DISCLOSURE_VERSION }, auth), undefined)).json();
    const res = await GET(new Request("http://localhost/api/v1/leagues", { headers: auth }), undefined);
    expect(await res.json()).toEqual({ leagues: [{ id: connected.leagueId, name: "App Test 8.17", espnLeagueId: "110222051", espnTeamId: 3, season: 2026 }] });
  });

  it("is empty, not an error, when in-season help isn't open to the account", async () => {
    vi.stubEnv("ESPN_SYNC_ALLOWLIST", "someone-else@example.test");
    const { GET } = await import("@/app/api/v1/leagues/route");
    const { auth } = await bearer();
    const res = await GET(new Request("http://localhost/api/v1/leagues", { headers: auth }), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leagues: [] });
  });
});
