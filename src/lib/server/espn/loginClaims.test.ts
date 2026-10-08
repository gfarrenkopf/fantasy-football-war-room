import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { espnLoginClaims } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { CLAIM_TTL_MS, MAX_LIVE_CLAIMS, createClaim, dropClaim, openClaim, peekClaim, purgeExpiredClaims } from "./loginClaims";
import { ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { acknowledgeDisclosure } from "./disclosure";
import type { ConnectRequest, ConnectResult } from "./seasonConnect";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  connects: [] as ConnectRequest[],
  result: null as unknown,
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/seasonConnect", () => ({
  connectSeason: async (_db: unknown, _key: unknown, _userId: string, req: ConnectRequest) => {
    state.connects.push(req);
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
const SCOPE = { espnLeagueId: "704343562", season: 2026, consentVersion: 1 };
const now = new Date("2026-10-06T12:00:00Z");

describe("ESPN login claims", () => {
  beforeEach(() => db.delete(espnLoginClaims));

  it("seals the login under a code, which opens it until the claim is dropped", async () => {
    const code = (await createClaim(db, KEY, LOGIN, SCOPE, now))!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(espnLoginClaims);
    expect(JSON.stringify(row)).not.toContain(LOGIN.espnS2);
    expect(JSON.stringify(row)).not.toContain(LOGIN.swid);
    expect(JSON.stringify(row)).not.toContain(code);

    expect(await peekClaim(db, code, now)).toEqual(SCOPE);
    expect(await openClaim(db, KEY, code, now)).toEqual({ ...SCOPE, login: LOGIN });
    expect(await openClaim(db, randomBytes(32), code, now)).toBeNull();
    expect(await openClaim(db, KEY, "not-the-code", now)).toBeNull();
    await dropClaim(db, code);
    expect(await openClaim(db, KEY, code, now)).toBeNull();
  });

  it("expires, and expired claims are swept", async () => {
    const code = (await createClaim(db, KEY, LOGIN, SCOPE, now))!;
    const later = new Date(now.getTime() + CLAIM_TTL_MS + 1);
    expect(await peekClaim(db, code, later)).toBeNull();
    expect(await openClaim(db, KEY, code, later)).toBeNull();
    await purgeExpiredClaims(db, later);
    expect(await db.select().from(espnLoginClaims)).toEqual([]);
  });

  it("refuses new claims once the table is full", async () => {
    const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
    const rows = Array.from({ length: MAX_LIVE_CLAIMS }, (_, i) => ({ tokenHash: `h${i}`, sealed: "x", ...SCOPE, expiresAt }));
    await db.insert(espnLoginClaims).values(rows);
    expect(await createClaim(db, KEY, LOGIN, SCOPE, now)).toBeNull();
    // Once they expire there's room again.
    expect(await createClaim(db, KEY, LOGIN, SCOPE, new Date(expiresAt.getTime() + 1))).toEqual(expect.any(String));
  });
});

async function routes(env: Record<string, string> = {}) {
  const vars = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: KEY.toString("base64"), ESPN_SYNC_ALLOWLIST: "", ...env };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const handoff = await import("@/app/api/espn/season/handoff/route");
  const claim = await import("@/app/api/espn/season/claim/route");
  return { handoff, claim };
}

const handoffPost = (body: unknown, origin = ESPN) =>
  new Request("http://localhost/api/espn/season/handoff", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
const claimPost = (claim: unknown, acknowledged?: number) =>
  new Request("http://localhost/api/espn/season/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claim, ...(acknowledged ? { acknowledged } : {}) }),
  });
const claimDelete = (claim: unknown, origin?: string) =>
  new Request("http://localhost/api/espn/season/claim", {
    method: "DELETE",
    headers: { "content-type": "application/json", host: "localhost", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ claim }),
  });

describe("handing a login from ESPN to Draft Room", () => {
  const body = { espnLeagueId: SCOPE.espnLeagueId, season: SCOPE.season, ...LOGIN };
  const connected = { espnLeagueId: SCOPE.espnLeagueId, season: SCOPE.season, consentVersion: ESPN_DISCLOSURE_VERSION, ...LOGIN };
  beforeEach(async () => {
    vi.resetModules();
    await db.delete(espnLoginClaims);
    state.connects = [];
    state.result = { ok: true, leagueId: "lg1", espnTeamId: 1, created: true } satisfies ConnectResult;
    state.user = { userId: await createTestUser(db), email: "fan@example.test" };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const handOff = async (handoff: Awaited<ReturnType<typeof routes>>["handoff"]) =>
    ((await (await handoff.POST(handoffPost(body))).json()) as { claim: string }).claim;

  it("answers ESPN's preflight only", async () => {
    const { handoff } = await routes();
    const options = (origin: string) => new Request("http://localhost/api/espn/season/handoff", { method: "OPTIONS", headers: { origin } });
    expect(handoff.OPTIONS(options(ESPN)).status).toBe(204);
    expect(handoff.OPTIONS(options("https://evil.example")).status).toBe(404);
  });

  it("parks the login under a claim, and asks the account to agree before using it (APE-332)", async () => {
    const { handoff, claim } = await routes();
    const res = await handoff.POST(handoffPost(body));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ESPN);
    const { claim: code } = (await res.json()) as { claim: string };

    const unasked = await claim.POST(claimPost(code), undefined);
    expect(unasked.status).toBe(428);
    expect(await unasked.json()).toEqual({ needsDisclosure: ESPN_DISCLOSURE_VERSION });
    expect(state.connects).toEqual([]);

    const first = await claim.POST(claimPost(code, ESPN_DISCLOSURE_VERSION), undefined);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ leagueId: "lg1", created: true });
    expect(state.connects).toEqual([connected]);
    expect((await claim.POST(claimPost(code), undefined)).status).toBe(410);
  });

  it("asks once per account: agreeing to it, here or when pairing a draft, covers the next connect", async () => {
    const { handoff, claim } = await routes();
    await claim.POST(claimPost(await handOff(handoff), ESPN_DISCLOSURE_VERSION), undefined);
    expect((await claim.POST(claimPost(await handOff(handoff)), undefined)).status).toBe(200);

    state.user = { userId: await createTestUser(db), email: "fan@example.test" };
    await acknowledgeDisclosure(db, state.user.userId, ESPN_DISCLOSURE_VERSION);
    expect((await claim.POST(claimPost(await handOff(handoff)), undefined)).status).toBe(200);
  });

  it("deletes the claim when the user says not now", async () => {
    const { handoff, claim } = await routes();
    const code = await handOff(handoff);
    expect((await claim.DELETE(claimDelete(code, "https://evil.example"))).status).toBe(403);
    expect((await claim.DELETE(claimDelete(code))).status).toBe(204);
    expect(await db.select().from(espnLoginClaims)).toEqual([]);
  });

  it("keeps the claim when ESPN can't be reached, so the user can retry", async () => {
    const { handoff, claim } = await routes();
    const code = await handOff(handoff);
    state.result = { ok: false, status: 503, error: "Couldn't reach ESPN." } satisfies ConnectResult;
    expect((await claim.POST(claimPost(code, ESPN_DISCLOSURE_VERSION), undefined)).status).toBe(503);
    state.result = { ok: false, status: 403, error: "No team." } satisfies ConnectResult;
    expect((await claim.POST(claimPost(code), undefined)).status).toBe(403);
    expect((await claim.POST(claimPost(code), undefined)).status).toBe(410);
  });

  it("refuses a malformed login, and claims from signed-out users", async () => {
    const { handoff, claim } = await routes();
    expect((await handoff.POST(handoffPost({ ...body, swid: "nope" }))).status).toBe(400);
    expect((await handoff.POST(handoffPost({ ...body, espnS2: "short" }))).status).toBe(400);
    expect((await handoff.POST(handoffPost({ ...body, espnLeagueId: "abc" }))).status).toBe(400);
    expect(await db.select().from(espnLoginClaims)).toEqual([]);

    const code = await handOff(handoff);
    state.user = null;
    expect((await claim.POST(claimPost(code, ESPN_DISCLOSURE_VERSION), undefined)).status).toBe(401);
    state.user = { userId: await createTestUser(db), email: "fan@example.test" };
    expect((await claim.POST(claimPost("../etc", ESPN_DISCLOSURE_VERSION), undefined)).status).toBe(400);
    expect(state.connects).toEqual([]);
  });

  it("is off without ESPN_CODE_KEY", async () => {
    const { handoff, claim } = await routes({ ESPN_CODE_KEY: "" });
    expect((await handoff.POST(handoffPost(body))).status).toBe(404);
    expect((await claim.POST(claimPost("x".repeat(43)), undefined)).status).toBe(404);
  });
});
