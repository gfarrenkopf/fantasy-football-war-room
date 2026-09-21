import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { parseEspnPlayers } from "@/lib/espn/crosswalk";
import espnPool from "@/lib/espn/__fixtures__/espn-players-2026.json";
import type { LiveEvent } from "@/lib/espn/live";
import { createTestLeague } from "../testLeagues";
import { mintBridgeToken } from "./bridgeTokens";

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

async function routes(env: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({ DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_SYNC_ALLOWLIST: "", ...env })) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const frames = await import("@/app/api/espn/bridge/frames/route");
  const stream = await import("@/app/api/leagues/[id]/espn/stream/route");
  return { frames, stream };
}

const ESPN = "https://fantasy.espn.com";
const post = (token: string | null, body: unknown, origin = ESPN) =>
  new Request("http://localhost/api/espn/bridge/frames", {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const PRE = ["CLOCK 0 5000", "STATE 1", "SELECTING 4 60000"];

/** Reads SSE events off a stream until `count` have arrived. */
async function readEvents(body: ReadableStream<Uint8Array>, count: number): Promise<LiveEvent[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: LiveEvent[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (data) events.push(JSON.parse(data.slice(6)));
    }
  }
  reader.releaseLock();
  return events;
}

describe("ESPN relay routes", () => {
  let userId: string;
  let leagueId: string;
  let token: string;

  beforeEach(async () => {
    vi.resetModules();
    const g = globalThis as { __espnRelay?: unknown; __espnTokenCache?: unknown };
    delete g.__espnRelay;
    delete g.__espnTokenCache;
    userId = await createTestUser(db, `${crypto.randomUUID()}@example.test`);
    leagueId = await createTestLeague(db, userId);
    state.user = { userId, email: "fan@example.test" };
    ({ token } = await mintBridgeToken(db, { userId, leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts a paired bridge's frames from ESPN's origin, with CORS for it", async () => {
    const { frames } = await routes();
    const res = await frames.POST(post(token, { espnLeagueId: "704343562", session: "abc12345", seq: 0, frames: PRE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ have: 3 });
    expect(res.headers.get("access-control-allow-origin")).toBe(ESPN);
  });

  it("answers the CORS preflight for ESPN only", async () => {
    const { frames } = await routes();
    const preflight = (origin: string) => new Request("http://localhost/api/espn/bridge/frames", { method: "OPTIONS", headers: { origin } });
    const ok = frames.OPTIONS(preflight(ESPN));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(frames.OPTIONS(preflight("https://evil.example")).status).toBe(404);
  });

  it("tells the bridge where the relay is when its offset doesn't match", async () => {
    const { frames } = await routes();
    const res = await frames.POST(post(token, { espnLeagueId: "704343562", session: "abc12345", seq: 7, frames: [] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ have: 0 });
  });

  it("refuses a missing or unknown token, a different ESPN league, and bad bodies", async () => {
    const { frames } = await routes();
    const body = { espnLeagueId: "704343562", session: "abc12345", seq: 0, frames: [] };
    expect((await frames.POST(post(null, body))).status).toBe(401);
    expect((await frames.POST(post("nope", body))).status).toBe(401);
    expect((await frames.POST(post(token, { ...body, espnLeagueId: "111" }))).status).toBe(403);
    expect((await frames.POST(post(token, { ...body, session: "BAD SESSION" }))).status).toBe(400);
    expect((await frames.POST(post(token, { ...body, frames: [1, 2] }))).status).toBe(400);
  });

  it("streams a snapshot, then each relayed pick resolved to the war room's players", async () => {
    const { frames, stream } = await routes();
    const res = await stream.GET(new Request(`http://localhost/api/leagues/${leagueId}/espn/stream`), { params: Promise.resolve({ id: leagueId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const [first] = await readEvents(res.body!, 1);
    expect(first).toMatchObject({ type: "snapshot", snapshot: { status: "waiting", picks: [] } });

    // ESPN's -16034 is the Texans D/ST, on the sample board.
    await frames.POST(post(token, { espnLeagueId: "704343562", session: "abc12345", seq: 0, frames: [...PRE, "SELECTED 4 -16034 8"] }));
    const next = await readEvents(res.body!, 3);
    expect(next).toContainEqual({ type: "status", status: "live", draft: "live" });
    expect(next).toContainEqual({
      type: "pick",
      pick: { n: 1, teamId: 4, mine: false, auto: true, espnPlayerId: -16034, playerId: "texans-d-st-dst-hou", offBoard: null },
    });
    await res.body!.cancel();
  });

  it("gates the stream like the rest of the feature", async () => {
    const { stream } = await routes({ ESPN_SYNC_ALLOWLIST: "owner@example.test" });
    const get = (id: string) => stream.GET(new Request(`http://localhost/api/leagues/${id}/espn/stream`), { params: Promise.resolve({ id }) });
    expect((await get(leagueId)).status).toBe(403);
    const other = await createTestLeague(db, await createTestUser(db));
    expect((await get(other)).status).toBe(404);
    state.user = null;
    expect((await get(leagueId)).status).toBe(401);
  });

  it("is off entirely without cloud features", async () => {
    const { frames } = await routes({ DATABASE_URL: "" });
    expect((await frames.POST(post(token, { espnLeagueId: "704343562", session: "abc12345", seq: 0, frames: [] }))).status).toBe(404);
  });
});
