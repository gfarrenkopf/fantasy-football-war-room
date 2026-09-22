import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs the shipped bridge (public/espn-bridge.js) in a sandbox standing in for an ESPN draft tab:
 * a fake page, a fake draft socket, and a spy fetch in place of War Room.
 */
const SOURCE = readFileSync(fileURLToPath(new URL("../../../public/espn-bridge.js", import.meta.url)), "utf8");
const WAR_ROOM = "https://draftroom.online";
const DRAFT_URL = "wss://fantasydraft.espn.com/game-1/league-704343562/JOIN?1=1";
const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";

type Listener = (e: { data?: unknown; origin?: string }) => void;

class FakeSocket {
  url: string;
  listeners: Record<string, Listener[]> = {};
  sent: unknown[] = [];
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  emit(data: string) {
    for (const fn of this.listeners.message ?? []) fn({ data });
  }
  close() {
    for (const fn of this.listeners.close ?? []) fn({});
  }
}

class FakeEl {
  hidden = false;
  textContent = "";
  style: Record<string, string> = {};
  onclick: (() => void) | null = null;
  children = new Map<string, FakeEl>();
  set innerHTML(_html: string) {}
  setAttribute() {}
  attachShadow() {
    return this;
  }
  querySelector(sel: string) {
    if (!this.children.has(sel)) this.children.set(sel, new FakeEl());
    return this.children.get(sel)!;
  }
  appendChild(el: FakeEl) {
    return el;
  }
}

function page({ href = "https://fantasy.espn.com/football/draft?leagueId=704343562&seasonId=2026&teamId=1", stored = null as string | null } = {}) {
  const url = new URL(href);
  const storage = new Map<string, string>(stored ? [["warroom-bridge:704343562", stored]] : []);
  const windowListeners: Listener[] = [];
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ have: 0 }), { status: 200 }));
  const open = vi.fn();
  const shadow = new FakeEl();
  const document = {
    currentScript: { src: `${WAR_ROOM}/espn-bridge.js` },
    createElement: () => shadow,
    body: new FakeEl(),
    documentElement: new FakeEl(),
  };
  const context: Record<string, unknown> = {
    document,
    location: { hostname: url.hostname, pathname: url.pathname, search: url.search },
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
    WebSocket: FakeSocket,
    fetch,
    open,
    addEventListener: (type: string, fn: Listener) => type === "message" && windowListeners.push(fn),
    URL,
    URLSearchParams,
    Response,
    setInterval,
    Date,
  };
  context.window = context;
  vm.createContext(context);
  const load = () => vm.runInContext(SOURCE, context);
  const bridge = () => (context.__warRoomBridge as { state(): Record<string, unknown> }).state();
  const Socket = () => context.WebSocket as typeof FakeSocket;
  const postMessage = (data: unknown, origin = WAR_ROOM) => windowListeners.forEach((fn) => fn({ data, origin }));
  const bodies = () =>
    fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as { espnLeagueId: string; session: string; seq: number; frames: string[] });
  return { load, bridge, Socket, postMessage, fetch, open, storage, shadow, bodies };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ESPN bridge", () => {
  it("relays nothing until paired, then sends sanitized frames with its token", async () => {
    const p = page();
    p.load();
    const ws = new (p.Socket())(DRAFT_URL);
    ws.emit("INIT AAAAAQAAAAEwSuJN\n");
    ws.emit(`TOKEN 1:704343562:1:${SWID}:342755166\n`);
    ws.emit("PONG PING%201790010141036\n");
    ws.emit(`SELECTED 1 4362628 4 ${SWID}\n`);
    ws.emit("SELECTED 4 4429795 2\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.fetch).not.toHaveBeenCalled();

    p.postMessage({ type: "warroom-bridge-paired", token: "tok-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = p.fetch.mock.calls[0];
    expect(url).toBe(`${WAR_ROOM}/api/espn/bridge/frames`);
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(p.bodies()[0]).toEqual({
      espnLeagueId: "704343562",
      session: expect.stringMatching(/^[a-z0-9]{8,}$/),
      seq: 0,
      frames: ["INIT", "TOKEN", "SELECTED 1 4362628 4 {00000000-0000-0000-0000-000000000000}", "SELECTED 4 4429795 2"],
    });
    // Nothing identifying left the tab.
    expect(JSON.stringify(p.bodies())).not.toContain("154E132F");
    expect(JSON.stringify(p.bodies())).not.toContain("342755166");
  });

  it("catches a socket opened before it loaded on the socket's next send, and never sends on it itself", async () => {
    const p = page({ stored: "tok-1" });
    const early = new (p.Socket())(DRAFT_URL);
    p.load();
    early.emit("SELECTED 2 1 1\n"); // not attached yet: missed
    early.send("PING PING%201");
    early.emit("SELECTED 3 2 1\n");
    await vi.advanceTimersByTimeAsync(300);
    expect(early.sent).toEqual(["PING PING%201"]);
    expect(p.bodies().flatMap((b) => b.frames)).toEqual(["SELECTED 3 2 1"]);
  });

  it("ignores sockets that aren't ESPN's draft socket", async () => {
    const p = page({ stored: "tok-1" });
    p.load();
    const other = new (p.Socket())("wss://espn.connections.edge.bamgrid.com/x");
    other.emit("SELECTED 1 1 1");
    await vi.advanceTimersByTimeAsync(300);
    expect(p.bodies().flatMap((b) => b.frames)).toEqual([]);
  });

  it("batches frames and advances by what War Room confirms", async () => {
    const p = page({ stored: "tok-1" });
    p.fetch.mockImplementation(async (_u, init) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ have: body.seq + body.frames.length }), { status: 200 });
    });
    p.load();
    await vi.advanceTimersByTimeAsync(0);
    const ws = new (p.Socket())(DRAFT_URL);
    ws.emit("SELECTED 1 1 1");
    ws.emit("SELECTED 2 2 1");
    await vi.advanceTimersByTimeAsync(300);
    ws.emit("SELECTED 3 3 1");
    await vi.advanceTimersByTimeAsync(300);
    const withFrames = p.bodies().filter((b) => b.frames.length);
    expect(withFrames.map((b) => [b.seq, b.frames.length])).toEqual([
      [0, 2],
      [2, 1],
    ]);
    expect(p.bridge()).toMatchObject({ status: "live", sent: 3, frames: 3 });
  });

  it("resends from where War Room is when it has lost frames (409), e.g. after a restart", async () => {
    const p = page({ stored: "tok-1" });
    let calls = 0;
    p.fetch.mockImplementation(async (_u, init) => {
      const body = JSON.parse(String(init.body));
      calls++;
      if (calls === 3) return new Response(JSON.stringify({ have: 0 }), { status: 409 });
      return new Response(JSON.stringify({ have: body.seq + body.frames.length }), { status: 200 });
    });
    p.load();
    const ws = new (p.Socket())(DRAFT_URL);
    ws.emit("SELECTED 1 1 1");
    await vi.advanceTimersByTimeAsync(300);
    ws.emit("SELECTED 2 2 1");
    await vi.advanceTimersByTimeAsync(300);
    ws.emit("SELECTED 3 3 1");
    await vi.advanceTimersByTimeAsync(600);
    const last = p.bodies().at(-1)!;
    expect(last).toMatchObject({ seq: 0, frames: ["SELECTED 1 1 1", "SELECTED 2 2 1", "SELECTED 3 3 1"] });
  });

  it("names each page load's frame log with its own session id", async () => {
    const a = page({ stored: "tok-1" });
    a.load();
    const b = page({ stored: "tok-1" });
    b.load();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5300);
    const sessionsA = new Set(a.bodies().map((x) => x.session));
    const sessionsB = new Set(b.bodies().map((x) => x.session));
    expect(sessionsA.size).toBe(1);
    expect(sessionsB.size).toBe(1);
    expect([...sessionsA][0]).not.toBe([...sessionsB][0]);
  });

  it("heartbeats while idle so War Room knows the tab is still there", async () => {
    const p = page({ stored: "tok-1" });
    p.load();
    await vi.advanceTimersByTimeAsync(0);
    const before = p.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5300);
    expect(p.fetch.mock.calls.length).toBe(before + 1);
    expect(p.bodies().at(-1)!.frames).toEqual([]);
  });

  it("drops an expired token and asks to connect again", async () => {
    const p = page({ stored: "tok-old" });
    p.fetch.mockResolvedValue(new Response("{}", { status: 401 }));
    p.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.bridge()).toMatchObject({ status: "expired", paired: false });
    expect(p.storage.has("warroom-bridge:704343562")).toBe(false);
    p.shadow.querySelector(".go").onclick!();
    expect(p.open).toHaveBeenCalledWith(`${WAR_ROOM}/espn/pair?league=704343562&team=1&season=2026`, "warroom-pair", expect.any(String));
  });

  it("backs off while War Room is unreachable, keeping every frame", async () => {
    const p = page({ stored: "tok-1" });
    p.fetch.mockRejectedValue(new Error("offline"));
    p.load();
    const ws = new (p.Socket())(DRAFT_URL);
    ws.emit("SELECTED 1 1 1");
    await vi.advanceTimersByTimeAsync(3000);
    expect(p.fetch.mock.calls.length).toBeLessThanOrEqual(2);
    expect(p.bridge()).toMatchObject({ status: "offline", frames: 1, sent: 0 });
  });

  it("ignores pairing messages from any origin but War Room's", async () => {
    const p = page();
    p.load();
    p.postMessage({ type: "warroom-bridge-paired", token: "evil" }, "https://evil.example");
    await vi.advanceTimersByTimeAsync(300);
    expect(p.fetch).not.toHaveBeenCalled();
    expect(p.bridge()).toMatchObject({ paired: false });
  });

  it("loads once: clicking the bookmark again just shows the overlay", async () => {
    const p = page({ stored: "tok-1" });
    p.load();
    p.load();
    const ws = new (p.Socket())(DRAFT_URL);
    ws.emit("SELECTED 1 1 1");
    await vi.advanceTimersByTimeAsync(300);
    expect(p.bodies().flatMap((b) => b.frames)).toEqual(["SELECTED 1 1 1"]);
  });

  it("does nothing but explain itself off the draft page", async () => {
    const p = page({ href: "https://fantasy.espn.com/football/league?leagueId=704343562" });
    p.load();
    await vi.advanceTimersByTimeAsync(300);
    expect(p.bridge()).toMatchObject({ onDraftPage: false, paired: false });
    expect(p.shadow.querySelector(".s").textContent).toContain("Open your ESPN draft room");
  });

  describe("picks made from War Room", () => {
    /** A paired bridge on team 1's draft page, with War Room handing it `command` once. */
    function withCommand(command: { id: string; select: number }) {
      const p = page({ stored: "tok-1" });
      let handedOut = false;
      p.fetch.mockImplementation(async (_u, init) => {
        const body = JSON.parse(String(init.body));
        const reply: Record<string, unknown> = { have: body.seq + body.frames.length };
        if (!handedOut) {
          handedOut = true;
          reply.command = command;
        }
        return new Response(JSON.stringify(reply), { status: 200 });
      });
      p.load();
      const ws = new (p.Socket())(DRAFT_URL);
      return { ...p, ws };
    }

    it("sends the pick on ESPN's own socket when ESPN has the user on the clock, and reports it", async () => {
      const p = withCommand({ id: "r1", select: 4362628 });
      p.ws.send("PING PING%201\n"); // the page's own send: frames end in a newline
      p.ws.emit("SELECTING 1 60000\n");
      await vi.advanceTimersByTimeAsync(300);
      expect(p.ws.sent).toEqual(["PING PING%201\n", "SELECT 4362628\n"]);
      await vi.advanceTimersByTimeAsync(300);
      expect(p.bodies().some((b) => (b as { result?: unknown }).result && JSON.stringify(b).includes('"sent":true'))).toBe(true);
    });

    it("refuses when the page doesn't have the user on the clock, and says why", async () => {
      const p = withCommand({ id: "r1", select: 4362628 });
      p.ws.emit("SELECTING 3 60000\n");
      await vi.advanceTimersByTimeAsync(600);
      expect(p.ws.sent).toEqual([]);
      expect(p.bodies().map((b) => (b as { result?: unknown }).result).find(Boolean)).toEqual({ id: "r1", sent: false, reason: "not-on-the-clock" });
    });

    it("never sends the same pick twice, even if War Room hands it out again", async () => {
      const p = page({ stored: "tok-1" });
      p.fetch.mockImplementation(async (_u, init) => {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ have: body.seq + body.frames.length, command: { id: "r1", select: 7 } }), { status: 200 });
      });
      p.load();
      const ws = new (p.Socket())(DRAFT_URL);
      ws.emit("SELECTING 1 60000");
      await vi.advanceTimersByTimeAsync(2000);
      ws.emit("SELECTING 1 60000");
      await vi.advanceTimersByTimeAsync(2000);
      expect(ws.sent.filter((f) => String(f).startsWith("SELECT"))).toHaveLength(1);
    });

    it("mirrors the page's frame format when its sends have no trailing newline", async () => {
      const p = withCommand({ id: "r1", select: 5 });
      p.ws.send("PING PING%201");
      p.ws.emit("SELECTING 1 60000");
      await vi.advanceTimersByTimeAsync(300);
      expect(p.ws.sent.at(-1)).toBe("SELECT 5");
    });
  });
});
