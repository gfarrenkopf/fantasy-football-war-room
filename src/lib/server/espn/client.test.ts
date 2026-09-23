import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Crosswalk } from "@/lib/espn/crosswalk";
import { createEspnClient, type EndReason, type EspnSocket, type EspnSocketEvents } from "./client";
import { createRelay, type IngestResult, type RelayScope } from "./relay";

const scope: RelayScope = { userId: "u1", leagueId: "L1", espnLeagueId: "704343562", espnTeamId: 1, season: 2026 };
const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";
const CODE = "-342755166";

/** A socket standing in for ESPN's draft socket. */
class FakeSocket implements EspnSocket {
  listeners: Record<string, ((arg?: unknown) => void)[]> = {};
  sent: string[] = [];
  closed = false;
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}
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

/** An ESPN INIT blob with these picks made (the layout from docs/espn-protocol.md §4.1). */
function initBlob(drafted: number[], total = 8, league = 704343562) {
  const header = 96;
  const bytes = new Uint8Array(header + 45 * total);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < total; k++) {
    view.setInt32(header + 45 * k, drafted[k] ?? -1);
    view.setInt32(header + 45 * k + 33, league);
  }
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "") + " ####";
}

function setup({ pickTeams = [4, 1, 2, 3, 3, 2, 1, 4] as number[] | null } = {}) {
  let socket!: FakeSocket;
  const ingest = vi.fn(async (_s: RelayScope, _session: string, seq: number, frames: readonly string[]): Promise<IngestResult> => ({
    status: 200,
    have: seq + frames.length,
  }));
  const ended: [EndReason, string][] = [];
  const joined = vi.fn();
  const client = createEspnClient({
    connect: (url, headers) => (socket = new FakeSocket(url, headers)),
    relay: { ingest },
    scope,
    credential: { code: CODE, swid: SWID },
    pickTeams,
    session: "srvtest",
    onJoin: joined,
    onEnd: (reason, detail) => ended.push([reason, detail]),
  });
  const frames = () => ingest.mock.calls.flatMap(([, , , f]) => [...f]);
  const join = () => {
    socket.fire("open");
    socket.fire("message", `TOKEN 1:704343562:1:${SWID}:${CODE}\n`);
  };
  return { client, socket, ingest, frames, ended, joined, join };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the server-side ESPN client", () => {
  it("joins as ESPN's page does: the page's URL, a browser User-Agent, ESPN's origin, no cookies", () => {
    const { socket } = setup();
    const url = new URL(socket.url);
    expect(url.origin + url.pathname).toBe("wss://fantasydraft.espn.com/game-1/league-704343562/JOIN");
    expect(url.searchParams.get("5")).toBe(`1:704343562:1:${SWID}:${CODE}`);
    expect(socket.headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 .*Chrome/);
    expect(socket.headers.Origin).toBe("https://fantasy.espn.com");
    expect(Object.keys(socket.headers).map((h) => h.toLowerCase())).not.toContain("cookie");
  });

  it("pings every 15s with the trailing newline ESPN needs to keep it", async () => {
    const { socket, join } = setup();
    join();
    await vi.advanceTimersByTimeAsync(45_000);
    const pings = socket.sent.filter((f) => f.startsWith("PING"));
    expect(pings).toHaveLength(3);
    for (const ping of pings) expect(ping).toMatch(/^PING PING%20\d+\n$/);
  });

  it("feeds the relay sanitized frames as its own session, and heartbeats while the draft is quiet", async () => {
    const { socket, ingest, frames, join, joined } = setup();
    join();
    expect(joined).toHaveBeenCalledOnce();
    socket.fire("message", "PONG PING%201\n");
    socket.fire("message", `SELECTED 4 4429795 2 ${SWID}\n`);
    await vi.advanceTimersByTimeAsync(0);
    expect(frames()).toEqual(["TOKEN", "SELECTED 4 4429795 2 {00000000-0000-0000-0000-000000000000}"]);
    expect(ingest.mock.calls.every(([s, session]) => s === scope && session === "srvtest")).toBe(true);
    expect(JSON.stringify(ingest.mock.calls)).not.toContain("342755166");
    expect(JSON.stringify(ingest.mock.calls)).not.toContain("154E132F");

    const before = ingest.mock.calls.length;
    for (let i = 0; i < 4; i++) {
      socket.fire("message", "CLOCK 6 30000 4\n"); // ESPN keeps talking; frames go as they come
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(ingest.mock.calls.length).toBeGreaterThan(before);
    socket.fire("message", "PONG PING%201\n");
    const quiet = ingest.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    // Nothing new to send, but it still checks in so the relay knows it's there.
    expect(ingest.mock.calls.length - quiet).toBeGreaterThanOrEqual(1);
    expect(ingest.mock.calls.slice(quiet).every(([, , , f]) => f.length === 0)).toBe(true);
  });

  it("resends from wherever the relay is when it holds a different count", async () => {
    const { socket, ingest, frames, join } = setup();
    ingest.mockImplementationOnce(async () => ({ status: 409, have: 0 }));
    join();
    socket.fire("message", "SELECTED 4 4429795 2\n");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(ingest.mock.calls.at(-1)![2]).toBe(0);
    expect(frames().filter((f) => f === "TOKEN").length).toBeGreaterThanOrEqual(2);
  });

  it("catches up from INIT when it joins mid-draft, in front of what follows", async () => {
    const { socket, frames, join } = setup();
    join();
    socket.fire("message", `INIT ${initBlob([4429795, 4430807, -16034])}\n`);
    socket.fire("message", "SELECTED 3 4362628 2\n");
    await vi.advanceTimersByTimeAsync(300);
    expect(frames()).toEqual(["TOKEN", "WR_CATCHUP 1 4 4429795", "WR_CATCHUP 2 1 4430807", "WR_CATCHUP 3 2 -16034", "INIT", "SELECTED 3 4362628 2"]);
  });

  it("skips catch-up without an owner for every pick, rather than crediting the wrong team", async () => {
    const { socket, frames, join } = setup({ pickTeams: null });
    join();
    socket.fire("message", `INIT ${initBlob([4429795])}\n`);
    await vi.advanceTimersByTimeAsync(300);
    expect(frames()).toEqual(["TOKEN", "INIT"]);
  });

  it("ends as refused when ESPN refuses the code, without reconnecting", async () => {
    const { socket, ended, frames } = setup();
    socket.fire("open");
    socket.fire("message", "ERROR 1 Invalid+security+code%3B+access+is+refused.\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toEqual([["refused", expect.stringContaining("fresh code")]]);
    expect(socket.closed).toBe(true);
    // Not relayed: a refused join isn't the draft's feed drifting.
    expect(frames()).not.toContain("ERROR 1 Invalid+security+code%3B+access+is+refused.");
    expect(JSON.stringify(ended)).not.toContain("342755166");
  });

  it("ends as refused on an HTTP answer instead of a socket", async () => {
    const { socket, ended } = setup();
    socket.fire("unexpected-response", 403);
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toEqual([["refused", expect.stringContaining("HTTP 403")]]);
  });

  it("ends as lost when ESPN takes the connection back, and never tries again", async () => {
    const { socket, ended, join } = setup();
    join();
    socket.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ended).toEqual([["lost", expect.stringContaining("reconnected in ESPN")]]);
  });

  it("ends as lost when ESPN goes quiet", async () => {
    const { ended, join } = setup();
    join();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(ended).toEqual([["lost", expect.stringContaining("stopped answering")]]);
  });

  it("delivers STATE 2 to the relay, then ends as complete", async () => {
    const { socket, frames, ended, join } = setup();
    join();
    socket.fire("message", "SELECTED 4 4429795 2\n");
    socket.fire("message", "STATE 2\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(frames().at(-1)).toBe("STATE 2");
    expect(ended).toEqual([["complete", expect.any(String)]]);
    expect(socket.closed).toBe(true);
  });

  it("stops when told to, closing the socket, and only sends while joined", async () => {
    const { client, socket, ended, join } = setup();
    expect(client.send("SELECT 1\n")).toBe(false);
    join();
    expect(client.send("SELECT 1\n")).toBe(true);
    client.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toEqual([["stopped", "Handed back to you."]]);
    expect(client.send("SELECT 2\n")).toBe(false);
    expect(socket.sent.filter((f) => f.startsWith("SELECT"))).toEqual(["SELECT 1\n"]);
  });

  it("lands picks on the board exactly as the bridge's do", async () => {
    const crosswalk: Crosswalk = (id) => (id === 4429795 ? { kind: "matched", playerId: "p1" } : { kind: "offBoard", player: { name: `ESPN ${id}`, pos: null, team: null } });
    const relay = createRelay({ now: () => Date.now(), crosswalkFor: async () => crosswalk, fallbackCrosswalk: crosswalk });
    let socket!: FakeSocket;
    createEspnClient({
      connect: (url, headers) => (socket = new FakeSocket(url, headers)),
      relay,
      scope,
      credential: { code: CODE, swid: SWID },
      pickTeams: null,
    });
    socket.fire("open");
    for (const f of ["TOKEN x", "CLOCK 0 5000", "STATE 1", "SELECTING 4 60000", "SELECTED 4 4429795 2", "SELECTING 1 60000"]) socket.fire("message", `${f}\n`);
    await vi.advanceTimersByTimeAsync(300);
    expect(relay.snapshot("u1", "L1")).toMatchObject({
      status: "live",
      picks: [{ n: 1, teamId: 4, espnPlayerId: 4429795, playerId: "p1" }],
      onClock: { teamId: 1 },
    });
  });
});
