import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { espnServerClients } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { parseEspnPlayers } from "@/lib/espn/crosswalk";
import espnPool from "@/lib/espn/__fixtures__/espn-players-2026.json";
import { createTestLeague } from "../testLeagues";
import { mintBridgeToken } from "./bridgeTokens";
import { loadCredential, purgeExpiredCredentials, storeCredential } from "./serverClients";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/server/espn/players", () => ({ getEspnPlayers: async () => parseEspnPlayers(espnPool) }));

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const KEY = randomBytes(32);
const ESPN = "https://fantasy.espn.com";
const CODE = "-342755166";
const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";

async function routes(env: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({
    DATABASE_URL: "postgres://localhost/unused",
    NEXTAUTH_SECRET: "secret",
    ESPN_CODE_KEY: KEY.toString("base64"),
    ...env,
  }))
    vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const handover = await import("@/app/api/espn/bridge/handover/route");
  const frames = await import("@/app/api/espn/bridge/frames/route");
  return { handover, frames };
}

const post = (path: string, token: string | null, body: unknown) =>
  new Request(`http://localhost/api/espn/bridge/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ESPN, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe("handing over the ESPN join code", () => {
  let userId: string;
  let leagueId: string;
  let token: string;
  const scope = () => ({ userId, leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });
  const body = { espnLeagueId: "704343562", consentVersion: 1, code: CODE, swid: SWID, settings: { size: 10 }, pickTeams: [2, 1, 3] };

  beforeEach(async () => {
    vi.resetModules();
    const g = globalThis as { __espnRelay?: unknown; __espnTokenCache?: unknown };
    delete g.__espnRelay;
    delete g.__espnTokenCache;
    userId = await createTestUser(db, `${crypto.randomUUID()}@example.test`);
    leagueId = await createTestLeague(db, userId);
    ({ token } = await mintBridgeToken(db, scope()));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stores the credential sealed, where only the server-side client can open it", async () => {
    const { handover } = await routes();
    const res = await handover.POST(post("handover", token, body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: true });
    expect(res.headers.get("access-control-allow-origin")).toBe(ESPN);

    const [row] = await db.select().from(espnServerClients).where(eq(espnServerClients.leagueId, leagueId));
    expect(JSON.stringify(row)).not.toContain("342755166");
    expect(JSON.stringify(row)).not.toContain("154E132F");
    expect(row).toMatchObject({ state: "stored", consentVersion: 1, pickTeams: [2, 1, 3], leagueSettings: { size: 10 } });

    const stored = await loadCredential(db, KEY, userId, leagueId);
    expect(stored).toMatchObject({ code: CODE, swid: SWID, scope: scope() });
    expect(await loadCredential(db, randomBytes(32), userId, leagueId)).toBeNull();
  });

  it("refuses without a token, for another ESPN league, a stale opt-in, or a malformed code", async () => {
    const { handover } = await routes();
    expect((await handover.POST(post("handover", null, body))).status).toBe(401);
    expect((await handover.POST(post("handover", token, { ...body, espnLeagueId: "111" }))).status).toBe(403);
    const stale = await handover.POST(post("handover", token, { ...body, consentVersion: 0 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ handoverVersion: 1 });
    expect((await handover.POST(post("handover", token, { ...body, code: "12ab" }))).status).toBe(400);
    expect((await handover.POST(post("handover", token, { ...body, swid: "nope" }))).status).toBe(400);
    expect(await loadCredential(db, KEY, userId, leagueId)).toBeNull();
  });

  it("is off without ESPN_CODE_KEY, and never mentioned to the bridge", async () => {
    const { handover, frames } = await routes({ ESPN_CODE_KEY: "" });
    expect((await handover.POST(post("handover", token, body))).status).toBe(404);
    const res = await frames.POST(post("frames", token, { espnLeagueId: "704343562", session: "abc12345", seq: 0, frames: [] }));
    expect(await res.json()).toEqual({ have: 0 });
  });

  it("offers the opt-in to a bridge that doesn't have it yet", async () => {
    const { frames } = await routes();
    const first = await (await frames.POST(post("frames", token, { espnLeagueId: "704343562", session: "abc12345", seq: 0, frames: [] }))).json();
    expect(first.handover).toEqual({ version: 1, lines: expect.arrayContaining([expect.stringContaining("disconnects")]) });
    const again = await (
      await frames.POST(post("frames", token, { espnLeagueId: "704343562", session: "abc12345", seq: 0, frames: [], handoverVersion: 1 }))
    ).json();
    expect(again.handover).toBeUndefined();
  });

  it("deletes the credential when the draft completes", async () => {
    const { handover, frames } = await routes();
    await handover.POST(post("handover", token, body));
    const res = await frames.POST(post("frames", token, { espnLeagueId: "704343562", session: "abc12345", seq: 0, frames: ["STATE 1", "STATE 2"] }));
    expect(res.status).toBe(200);
    expect(await db.select().from(espnServerClients).where(eq(espnServerClients.leagueId, leagueId))).toEqual([]);
  });

  it("keeps a take-over through a fresh hand-over for the same draft, and sweeps expired credentials", async () => {
    const t0 = new Date("2026-09-23T18:00:00Z");
    await storeCredential(db, KEY, scope(), { code: CODE, swid: SWID }, { consentVersion: 1 }, t0);
    await db.update(espnServerClients).set({ state: "holding" }).where(eq(espnServerClients.leagueId, leagueId));
    await storeCredential(db, KEY, scope(), { code: "42", swid: SWID }, { consentVersion: 1 }, t0);
    expect(await loadCredential(db, KEY, userId, leagueId, t0)).toMatchObject({ code: "42", state: "holding" });
    // A different draft starts over.
    await storeCredential(db, KEY, { ...scope(), espnTeamId: 2 }, { code: "43", swid: SWID }, { consentVersion: 1 }, t0);
    expect(await loadCredential(db, KEY, userId, leagueId, t0)).toMatchObject({ code: "43", state: "stored" });

    const later = new Date(t0.getTime() + 13 * 60 * 60 * 1000);
    expect(await loadCredential(db, KEY, userId, leagueId, later)).toBeNull();
    await purgeExpiredCredentials(db, later);
    expect(await db.select().from(espnServerClients).where(eq(espnServerClients.leagueId, leagueId))).toEqual([]);
  });
});
