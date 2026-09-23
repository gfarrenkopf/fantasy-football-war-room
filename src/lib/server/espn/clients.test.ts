import { randomBytes } from "node:crypto";
import { eq, ne } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { espnServerClients } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { parseEspnPlayers } from "@/lib/espn/crosswalk";
import espnPool from "@/lib/espn/__fixtures__/espn-players-2026.json";
import { createTestLeague } from "../testLeagues";
import type { EspnSocket, EspnSocketEvents } from "./client";
import { storeCredential } from "./serverClients";

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

const KEY = randomBytes(32);
const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";

class FakeSocket implements EspnSocket {
  listeners: Record<string, ((arg?: unknown) => void)[]> = {};
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {}
  on<E extends keyof EspnSocketEvents>(event: E, listener: (...args: EspnSocketEvents[E]) => void) {
    (this.listeners[event] ??= []).push(listener as (arg?: unknown) => void);
  }
  fire(event: string, arg?: unknown) {
    for (const fn of this.listeners[event] ?? []) fn(arg);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.fire("close");
  }
}

/** An ESPN INIT blob with these picks made (docs/espn-protocol.md §4.1). */
function initBlob(drafted: number[], total = 8, league = 704343562) {
  const bytes = new Uint8Array(96 + 45 * total);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < total; k++) {
    view.setInt32(96 + 45 * k, drafted[k] ?? -1);
    view.setInt32(96 + 45 * k + 33, league);
  }
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "") + " ####";
}

async function load() {
  for (const [name, value] of Object.entries({ DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: KEY.toString("base64") }))
    vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const clients = await import("./clients");
  const { getRelay } = await import("./live");
  const route = await import("@/app/api/leagues/[id]/espn/server-client/route");
  return { ...clients, relay: getRelay(), route };
}

describe("taking over and handing back an ESPN draft connection", () => {
  let userId: string;
  let leagueId: string;
  let sockets: FakeSocket[];
  const connect = (url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  };
  /** Earlier tests share the database and leave drafts held; a restart would resume those too. */
  const releaseOthers = () => db.update(espnServerClients).set({ state: "released" }).where(ne(espnServerClients.leagueId, leagueId));
  const row = async () => (await db.select().from(espnServerClients).where(eq(espnServerClients.leagueId, leagueId)))[0];

  beforeEach(async () => {
    vi.resetModules();
    const g = globalThis as { __espnRelay?: unknown; __espnClients?: unknown };
    delete g.__espnRelay;
    delete g.__espnClients;
    sockets = [];
    userId = await createTestUser(db, `${crypto.randomUUID()}@example.test`);
    leagueId = await createTestLeague(db, userId);
    state.user = { userId, email: "fan@example.test" };
    await storeCredential(db, KEY, { userId, leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 }, { code: "-42", swid: SWID }, { consentVersion: 1, pickTeams: [1, 2] });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("joins with the stored code, holds the connection, and says so to every war room", async () => {
    const { takeOver, relay } = await load();
    expect(await takeOver(db, userId, leagueId, { connect })).toEqual({ ok: true });
    expect(sockets).toHaveLength(1);
    expect(new URL(sockets[0].url).searchParams.get("5")).toBe(`1:704343562:1:${SWID}:-42`);
    expect(relay.serverClient(userId, leagueId)).toEqual({ state: "connecting" });
    expect((await row()).state).toBe("holding");

    sockets[0].fire("open");
    sockets[0].fire("message", "TOKEN x\n");
    expect(relay.serverClient(userId, leagueId)).toEqual({ state: "holding" });
    // Asking again doesn't open a second connection.
    expect(await takeOver(db, userId, leagueId, { connect })).toEqual({ ok: true });
    expect(sockets).toHaveLength(1);
  });

  it("marks the draft lost when ESPN takes the connection back, and doesn't reconnect", async () => {
    const { takeOver, relay, clientFor } = await load();
    await takeOver(db, userId, leagueId, { connect });
    sockets[0].fire("open");
    sockets[0].fire("message", "TOKEN x\n");
    sockets[0].close();
    await vi.waitFor(async () => expect((await row()).state).toBe("lost"));
    expect(relay.serverClient(userId, leagueId)).toMatchObject({ state: "lost", reason: expect.stringContaining("reconnected in ESPN") });
    expect(clientFor(userId, leagueId)).toBeNull();
    expect(sockets).toHaveLength(1);
  });

  it("hands back on request, closing the socket", async () => {
    const { takeOver, handBack, relay } = await load();
    await takeOver(db, userId, leagueId, { connect });
    sockets[0].fire("open");
    await handBack(db, userId, leagueId);
    expect(sockets[0].closed).toBe(true);
    await vi.waitFor(async () => expect((await row()).state).toBe("released"));
    expect(relay.serverClient(userId, leagueId)).toEqual({ state: "released" });
  });

  it("deletes the code when the draft completes", async () => {
    const { takeOver, relay } = await load();
    await takeOver(db, userId, leagueId, { connect });
    sockets[0].fire("open");
    sockets[0].fire("message", "TOKEN x\n");
    sockets[0].fire("message", "STATE 2\n");
    await vi.waitFor(async () => expect(await row()).toBeUndefined());
    expect(relay.serverClient(userId, leagueId)).toEqual({ state: "complete" });
  });

  it("sends a War Room pick and the turn plan's queue on its own socket (9.3)", async () => {
    const { takeOver, relay } = await load();
    await takeOver(db, userId, leagueId, { connect });
    sockets[0].fire("open");
    for (const f of ["TOKEN x", "CLOCK 0 5000", "STATE 1", "SELECTING 1 60000"]) sockets[0].fire("message", `${f}\n`);
    await vi.waitFor(() => expect(relay.snapshot(userId, leagueId).status).toBe("live"));
    expect(relay.requestPick(userId, leagueId, { playerId: "p1", espnPlayerId: 4429795 })).toMatchObject({ ok: true, request: { state: "sent" } });
    expect(sockets[0].sent).toContain("SELECT 4429795\n");

    const p = { playerId: "p2", espnPlayerId: 4430807, name: "B", pos: "WR" as const, team: "DET", bye: 8, badge: "80%" };
    relay.publishPlan(userId, leagueId, { picks: [1], rounds: "1", onClock: true, targets: [p], fallbacks: [], best: [], after: null });
    expect(relay.pushQueue(userId, leagueId)).toEqual([4430807]);
    expect(sockets[0].sent).toContain("DRAFT_LIST 4430807\n");
    expect(relay.setAutopick(userId, leagueId, false)).toBe(true);
    expect(sockets[0].sent).toContain("AUTODRAFT false\n");
  });

  it("rejoins a held draft after a restart, and recovers the picks made in the gap from INIT (9.5)", async () => {
    const first = await load();
    await first.takeOver(db, userId, leagueId, { connect });
    sockets[0].fire("open");
    for (const f of ["TOKEN x", "CLOCK 0 5000", "STATE 1", "SELECTING 1 60000", "SELECTED 1 4429795 2"]) sockets[0].fire("message", `${f}\n`);
    await vi.waitFor(() => expect(first.relay.snapshot(userId, leagueId).picks).toHaveLength(1));

    // The process dies: its memory, relay and socket go with it. The row still says holding.
    vi.resetModules();
    const g = globalThis as { __espnRelay?: unknown; __espnClients?: unknown };
    delete g.__espnRelay;
    delete g.__espnClients;
    const next = await load();
    expect(next.relay.snapshot(userId, leagueId).picks).toEqual([]);

    await releaseOthers();
    expect(await next.resumeServerClients(db, { connect })).toBe(1);
    expect(next.relay.serverClient(userId, leagueId)).toMatchObject({ state: "connecting", reason: expect.stringContaining("restarted") });
    const socket = sockets[1];
    socket.fire("open");
    // ESPN's INIT on rejoin carries every pick: ours from before, and team 2's made while we were down.
    socket.fire("message", `INIT ${initBlob([4429795, 4430807])}\n`);
    socket.fire("message", "SELECTING 1 60000\n");
    await vi.waitFor(() =>
      expect(next.relay.snapshot(userId, leagueId).picks.map((p) => [p.n, p.teamId, p.espnPlayerId])).toEqual([
        [1, 1, 4429795],
        [2, 2, 4430807],
      ]),
    );
    expect(next.relay.serverClient(userId, leagueId)).toEqual({ state: "holding" });
    expect(next.relay.snapshot(userId, leagueId)).toMatchObject({ status: "live", anchored: true });
  });

  it("doesn't resume drafts that were handed back, lost or never taken over", async () => {
    const { resumeServerClients } = await load();
    await releaseOthers();
    await db.update(espnServerClients).set({ state: "lost" }).where(eq(espnServerClients.leagueId, leagueId));
    expect(await resumeServerClients(db, { connect })).toBe(0);
    expect(sockets).toHaveLength(0);
  });

  it("waits for an open ESPN tab to stand down before joining, so the page can't take the connection back", async () => {
    const { takeOver, relay } = await load();
    const scope = { userId, leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 };
    await relay.ingest(scope, "tab1", 0, ["CLOCK 0 5000"]); // a bridge is live in the user's ESPN tab
    const pending = takeOver(db, userId, leagueId, { connect, standDownMs: 2_000 });
    await new Promise((r) => setTimeout(r, 150));
    expect(sockets).toHaveLength(0); // not yet: the tab hasn't heard
    expect((await relay.ingest(scope, "tab1", 1, [])) as { held?: true }).toMatchObject({ held: true });
    expect(await pending).toEqual({ ok: true });
    expect(sockets).toHaveLength(1);
  });

  it("releases the tab when it never gets in", async () => {
    const { takeOver, relay } = await load();
    const scope = { userId, leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 };
    await relay.ingest(scope, "tab1", 0, ["CLOCK 0 5000"]);
    await takeOver(db, userId, leagueId, { connect, standDownMs: 50 });
    sockets[0].fire("unexpected-response", 500);
    await vi.waitFor(async () => expect((await row()).state).toBe("lost"));
    expect((await relay.ingest(scope, "tab1", 1, [])) as { held?: true }).not.toHaveProperty("held");
  });

  it("refuses to take over without a handed-over code", async () => {
    const { takeOver } = await load();
    const other = await createTestLeague(db, userId, "No code");
    expect(await takeOver(db, userId, other, { connect })).toEqual({ ok: false, reason: "no-credential" });
    expect(sockets).toHaveLength(0);
  });

  it("gates the route like the rest of ESPN sync", async () => {
    const { route } = await load();
    const call = (id: string, body: unknown) =>
      route.POST(
        new Request(`http://localhost/api/leagues/${id}/espn/server-client`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );
    expect((await call("not-mine", { action: "take-over" })).status).toBe(404);
    expect((await call(leagueId, { action: "dance" })).status).toBe(400);
    const other = await createTestLeague(db, userId, "No code");
    const refused = await call(other, { action: "take-over" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ reason: "no-credential" });
    expect((await call(leagueId, { action: "hand-back" })).status).toBe(202);
    expect((await row()).state).toBe("released");
  });
});
