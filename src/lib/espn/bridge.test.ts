import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeInitPicks, sanitizeFrame } from "./join";

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

/** Just enough DOM for the overlay: static elements by selector, and built elements with children. */
class FakeEl {
  hidden = false;
  className = "";
  type = "";
  title = "";
  style: Record<string, string> = {};
  onclick: (() => void) | null = null;
  own = "";
  kids: FakeEl[] = [];
  selectors = new Map<string, FakeEl>();
  get textContent(): string {
    return this.own + this.kids.map((k) => k.textContent).join(" ");
  }
  set textContent(value: string) {
    this.own = value;
    this.kids = [];
  }
  set innerHTML(_html: string) {}
  setAttribute() {}
  attachShadow() {
    return this;
  }
  querySelector(sel: string) {
    if (!this.selectors.has(sel)) this.selectors.set(sel, new FakeEl());
    return this.selectors.get(sel)!;
  }
  appendChild(el: FakeEl) {
    return el;
  }
  append(...els: FakeEl[]) {
    this.kids.push(...els);
  }
  replaceChildren(...els: FakeEl[]) {
    this.kids = els;
  }
  /** Every descendant, depth first. */
  all(): FakeEl[] {
    return this.kids.flatMap((k) => [k, ...k.all()]);
  }
}

function page({ href = "https://fantasy.espn.com/football/draft?leagueId=704343562&seasonId=2026&teamId=1", stored = null as string | null } = {}) {
  const url = new URL(href);
  const storage = new Map<string, string>(stored ? [["warroom-bridge:704343562", stored]] : []);
  const windowListeners: Listener[] = [];
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ have: 0 }), { status: 200 }));
  const open = vi.fn();
  const shadow = new FakeEl();
  const keyListeners: ((e: { key: string; preventDefault(): void }) => void)[] = [];
  const document = {
    currentScript: { src: `${WAR_ROOM}/espn-bridge.js` },
    // The overlay's host attaches the shared shadow root; everything else is a fresh element.
    createElement: () => Object.assign(new FakeEl(), { attachShadow: () => shadow }),
    body: new FakeEl(),
    documentElement: new FakeEl(),
    activeElement: null,
    addEventListener: (type: string, fn: (e: { key: string; preventDefault(): void }) => void) => type === "keydown" && keyListeners.push(fn),
  };
  const press = (key: string) => keyListeners.forEach((fn) => fn({ key, preventDefault() {} }));
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
    setTimeout,
    Date,
    atob,
  };
  context.window = context;
  vm.createContext(context);
  const load = () => vm.runInContext(SOURCE, context);
  const bridge = () => (context.__warRoomBridge as { state(): Record<string, unknown> }).state();
  const decode = (b64: string, league: number) =>
    (context.__warRoomBridge as { decodeInitPicks(b64: string, league: number): number[] | null }).decodeInitPicks(b64, league);
  const Socket = () => context.WebSocket as typeof FakeSocket;
  const postMessage = (data: unknown, origin = WAR_ROOM) => windowListeners.forEach((fn) => fn({ data, origin }));
  /** The frame posts only: the bridge also calls ESPN's own API when it catches up. */
  const bodies = () =>
    fetch.mock.calls
      .filter(([url, init]) => init && init.body && String(url).endsWith("/frames"))
      .map(([, init]) => JSON.parse(String(init.body)) as { espnLeagueId: string; session: string; seq: number; frames: string[]; planVersion: number; handoverVersion?: number });
  return { load, bridge, decode, Socket, postMessage, fetch, open, storage, shadow, bodies, press };
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
    // The frame post; pairing also asks ESPN for the league's settings (8.8).
    const posts = p.fetch.mock.calls.filter(([, init]) => init && init.body);
    expect(posts).toHaveLength(1);
    const [url, init] = posts[0];
    expect(url).toBe(`${WAR_ROOM}/api/espn/bridge/frames`);
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(p.bodies()[0]).toEqual({
      espnLeagueId: "704343562",
      session: expect.stringMatching(/^[a-z0-9]{8,}$/),
      planVersion: 0,
      handoverVersion: 0,
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
    expect(p.bodies().find((b) => b.frames.length)!.frames).toEqual(["SELECTED 3 2 1"]);
  });

  it("posts a frame as soon as it arrives, without waiting for the interval", async () => {
    const p = page({ stored: "tok-1" });
    p.fetch.mockImplementation(async (_u, init) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ have: body.seq + body.frames.length }), { status: 200 });
    });
    p.load();
    await vi.advanceTimersByTimeAsync(300); // the first heartbeat
    const ws = new (p.Socket())(DRAFT_URL);
    ws.emit("CLOCK 6 30000 4");
    ws.emit("SELECTING 1 60000");
    await vi.advanceTimersByTimeAsync(0);
    expect(p.bodies().filter((b) => b.frames.length).map((b) => b.frames)).toEqual([["CLOCK 6 30000 4", "SELECTING 1 60000"]]);
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
    // Call 3 was refused with 409; the next post starts over from what War Room says it holds.
    expect(p.bodies()[3]).toMatchObject({ seq: 0, frames: ["SELECTED 1 1 1", "SELECTED 2 2 1"] });
    expect(p.bodies().at(-1)).toMatchObject({ seq: 2, frames: ["SELECTED 3 3 1"] });
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
    expect(p.bodies().find((b) => b.frames.length)!.frames).toEqual(["SELECTED 1 1 1"]);
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

  describe("the turn plan in the overlay", () => {
    const player = (espnPlayerId: number, name: string, badge = "100%") => ({ playerId: `p${espnPlayerId}`, espnPlayerId, name, pos: "TE", team: "BUF", bye: 7, badge });
    const plan = {
      picks: [108],
      rounds: "11",
      onClock: false,
      targets: [player(11, "Dalton Kincaid"), player(12, "Travis Kelce"), player(13, "Isaiah Likely"), player(14, "Jake Ferguson")],
      fallbacks: [player(15, "Mark Andrews", "99%")],
      best: [{ ...player(16, "Tony Pollard", "#84"), pos: "RB" }],
      after: { picks: [113], names: ["Caleb Williams"] },
    };

    /** A paired, live bridge whose War Room has published `plan`. */
    async function withPlan() {
      const p = page({ stored: "tok-1" });
      p.fetch.mockImplementation(async (_u, init) => {
        const body = JSON.parse(String(init.body));
        const reply: Record<string, unknown> = { have: body.seq + body.frames.length };
        if (body.planVersion < 1) reply.plan = { version: 1, plan };
        return new Response(JSON.stringify(reply), { status: 200 });
      });
      p.load();
      const ws = new (p.Socket())(DRAFT_URL);
      ws.emit("CLOCK 0 5000");
      await vi.advanceTimersByTimeAsync(300);
      const rows = () => p.shadow.querySelector(".rows").all().filter((e) => e.className.startsWith("p"));
      const buttons = () => p.shadow.querySelector(".rows").all().filter((e) => e.className.startsWith("d"));
      return { ...p, ws, rows, buttons, title: () => p.shadow.querySelector(".pt").textContent, note: () => p.shadow.querySelector(".note").textContent };
    }

    it("shows the top three targets collapsed, and every section expanded", async () => {
      const p = await withPlan();
      expect(p.bridge()).toMatchObject({ planVersion: 1 });
      expect(p.title()).toBe("Your next turn: pick 108");
      expect(p.rows().map((r) => r.textContent)).toEqual([
        expect.stringContaining("Dalton Kincaid"),
        expect.stringContaining("Travis Kelce"),
        expect.stringContaining("Isaiah Likely"),
      ]);
      p.shadow.querySelector(".more").onclick!();
      expect(p.rows()).toHaveLength(6);
      expect(p.note()).toContain("After that, pick 113: Caleb Williams");
      // It asks for the plan once, then only when a newer one exists.
      await vi.advanceTimersByTimeAsync(5300);
      expect(p.bodies().at(-1)!.planVersion).toBe(1);
    });

    it("drops players as soon as they're drafted", async () => {
      const p = await withPlan();
      p.ws.emit("SELECTED 3 11 4");
      expect(p.rows().map((r) => r.textContent).join()).not.toContain("Dalton Kincaid");
      expect(p.rows()[0].textContent).toContain("Travis Kelce");
    });

    it("offers Draft only on the user's turn: arm, then confirm, sends it on ESPN's socket", async () => {
      const p = await withPlan();
      expect(p.buttons()).toHaveLength(0);
      p.ws.emit("SELECTING 1 60000");
      expect(p.title()).toBe("You're on the clock: pick 108");
      expect(p.buttons().map((b) => b.textContent)).toEqual(["Draft", "Draft", "Draft"]);

      p.buttons()[1].onclick!(); // arm Kelce
      expect(p.ws.sent).toEqual([]);
      expect(p.buttons().map((b) => b.textContent)).toEqual(["Draft", "Confirm", "Draft"]);
      expect(p.note()).toContain("Travis Kelce");
      p.buttons()[1].onclick!(); // confirm
      expect(p.ws.sent).toEqual(["SELECT 12\n"]);
      expect(p.note()).toBe("Drafting Travis Kelce in ESPN…");
      p.ws.emit("SELECTED 1 12 4");
      expect(p.bridge()).toMatchObject({ drafting: null });
    });

    it("drafts the armed player with Enter, cancels with Escape, and disarms when the turn passes", async () => {
      const p = await withPlan();
      p.ws.emit("SELECTING 1 60000");
      p.buttons()[0].onclick!();
      p.press("Escape");
      expect(p.bridge()).toMatchObject({ armed: null });
      p.buttons()[0].onclick!();
      p.press("Enter");
      expect(p.ws.sent).toEqual(["SELECT 11\n"]);

      const q = await withPlan();
      q.ws.emit("SELECTING 1 60000");
      q.buttons()[0].onclick!();
      q.ws.emit("SELECTING 2 60000");
      expect(q.bridge()).toMatchObject({ armed: null });
      q.press("Enter");
      expect(q.ws.sent).toEqual([]);
    });

    it("says where the plan comes from when War Room hasn't published one", async () => {
      const p = page({ stored: "tok-1" });
      p.load();
      new (p.Socket())(DRAFT_URL).emit("CLOCK 0 5000");
      await vi.advanceTimersByTimeAsync(300);
      expect(p.shadow.querySelector(".note").textContent).toContain("Open your War Room board");
    });
  });
});

/**
 * An INIT blob in ESPN's layout (docs/espn-protocol.md §4.1): a header, then one 45-byte record per
 * pick slot, each holding the drafted player id (or -1) and this league's id. Built rather than
 * captured, so no real member GUIDs live in the repo.
 */
function initBlob({ league = 704343562, total = 8, drafted = [] as number[], header = 96, leagueAt = 33, stride = 45 } = {}) {
  const bytes = new Uint8Array(header + stride * total);
  const view = new DataView(bytes.buffer);
  // A header field carrying the league id too: the real blob has one, and it's why the decoder
  // can't just trust the first match.
  view.setInt32(header - stride + leagueAt, league);
  for (let k = 0; k < total; k++) {
    const at = header + stride * k;
    view.setInt32(at, drafted[k] ?? -1);
    view.setInt32(at + leagueAt, league);
  }
  // ESPN sends "INIT <base64> ####…": the base64 loses its = padding and a run of # follows it.
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "") + ` ${"#".repeat(32)}`;
}

describe("the server-side client's ports of the bridge (Epic 9)", () => {
  it("decodes INIT exactly as the shipped bridge does", () => {
    const p = page();
    p.load();
    const blobs = [
      initBlob({ drafted: [4429795, 4430807, -16034] }),
      initBlob({ total: 160, drafted: Array.from({ length: 37 }, (_, i) => 3_000_000 + i) }),
      initBlob({ header: 51, drafted: [4429795] }),
      initBlob({ drafted: [] }),
      initBlob({ league: 1, drafted: [4429795] }),
      "not base64 at all!",
    ];
    for (const blob of blobs) expect(decodeInitPicks(blob, 704343562)).toEqual(p.decode(blob, 704343562));
  });

  it("sanitizes frames exactly as the shipped bridge does", async () => {
    const p = page({ stored: "tok-1" });
    p.load();
    const raw = ["INIT AAAA\n", `TOKEN 1:704343562:1:${SWID}:342755166\n`, "PONG PING%201\n", `SELECTED 1 4362628 4 ${SWID}\n`, "CLOCK 6 30000 4", "  "];
    const ws = new (p.Socket())(DRAFT_URL);
    raw.forEach((f) => ws.emit(f));
    await vi.advanceTimersByTimeAsync(300);
    expect(p.bodies().find((b) => b.frames.length)!.frames).toEqual(raw.map(sanitizeFrame).filter((f) => f !== null));
  });
});

describe("catching up on picks made before the bridge attached (8.12)", () => {
  const DRAFTED = [4429795, 4430807, -16034];
  /** ESPN's pre-listed pick ownership: every slot's team, known even mid-draft. */
  const OWNERSHIP = {
    draftDetail: { picks: [4, 1, 2, 3, 3, 2, 1, 4].map((teamId, i) => ({ overallPickNumber: i + 1, teamId })) },
  };

  function paired(blob: string, ownership: unknown = OWNERSHIP) {
    const p = page({ stored: "tok-1" });
    p.fetch.mockImplementation(async (url, init) => {
      if (url.includes("lm-api-reads")) return new Response(JSON.stringify(ownership), { status: 200 });
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ have: body.seq + body.frames.length }), { status: 200 });
    });
    p.load();
    const ws = new (p.Socket())(DRAFT_URL);
    ws.emit(`INIT ${blob}\n`);
    return { p, ws };
  }

  it("decodes the draft so far from INIT and sends it as its own frames, never the blob", async () => {
    const { p, ws } = paired(initBlob({ league: 704343562, drafted: DRAFTED }));
    await vi.advanceTimersByTimeAsync(300);
    ws.emit("SELECTED 3 4362628 2");
    await vi.advanceTimersByTimeAsync(300);

    const frames = p.bodies().flatMap((b) => b.frames);
    expect(frames).toEqual([
      "WR_CATCHUP 1 4 4429795",
      "WR_CATCHUP 2 1 4430807",
      "WR_CATCHUP 3 2 -16034",
      "INIT",
      "SELECTED 3 4362628 2",
    ]);
    // The blob stays in the ESPN tab.
    expect(JSON.stringify(p.bodies())).not.toContain(initBlob({ league: 704343562, drafted: DRAFTED }).slice(0, 24));
  });

  it("holds live frames until catch-up lands, so the recovered picks stay in front", async () => {
    const { p, ws } = paired(initBlob({ drafted: DRAFTED }));
    ws.emit("SELECTED 3 4362628 2"); // arrives while mDraftDetail is still in flight
    await vi.advanceTimersByTimeAsync(300);
    const frames = p.bodies().flatMap((b) => b.frames);
    expect(frames.indexOf("SELECTED 3 4362628 2")).toBeGreaterThan(frames.indexOf("WR_CATCHUP 3 2 -16034"));
  });

  it("sends no catch-up when nothing is drafted yet, or when the layout isn't the one we know", async () => {
    const empty = paired(initBlob({ drafted: [] }));
    await vi.advanceTimersByTimeAsync(300);
    expect(empty.p.bodies().flatMap((b) => b.frames)).toEqual(["INIT"]);

    const foreign = paired(initBlob({ league: 999, drafted: DRAFTED }));
    await vi.advanceTimersByTimeAsync(300);
    expect(foreign.p.bodies().flatMap((b) => b.frames)).toEqual(["INIT"]);
  });

  it("carries on when ESPN won't say who owns the picks", async () => {
    const { p, ws } = paired(initBlob({ drafted: DRAFTED }), null);
    await vi.advanceTimersByTimeAsync(300);
    ws.emit("SELECTED 3 4362628 2");
    await vi.advanceTimersByTimeAsync(300);
    expect(p.bodies().flatMap((b) => b.frames)).toEqual(["INIT", "SELECTED 3 4362628 2"]);
  });

  it("only tries once, and not when it has already seen picks of its own", async () => {
    const p = page({ stored: "tok-1" });
    p.fetch.mockImplementation(async (url, init) => {
      if (url.includes("lm-api-reads")) return new Response(JSON.stringify(OWNERSHIP), { status: 200 });
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ have: body.seq + body.frames.length }), { status: 200 });
    });
    p.load();
    const ws = new (p.Socket())(DRAFT_URL);
    ws.emit("SELECTED 3 4362628 2");
    ws.emit(`INIT ${initBlob({ drafted: DRAFTED })}\n`);
    await vi.advanceTimersByTimeAsync(300);
    expect(p.bodies().flatMap((b) => b.frames)).toEqual(["SELECTED 3 4362628 2", "INIT"]);
    expect(p.fetch.mock.calls.filter(([u]) => u.includes("mDraftDetail"))).toHaveLength(0);
  });
});

describe("telling War Room how ESPN has this league set up (8.8)", () => {
  const SETTINGS = {
    settings: {
      size: 4,
      name: "App Test",
      draftSettings: { type: "SNAKE", pickOrder: [1, 3, 4, 2], timePerSelection: 300 },
      rosterSettings: { lineupSlotCounts: { "0": 1, "2": 2, "20": 3 } },
      // A real league carries dozens of these; only the reception item should travel.
      scoringSettings: { scoringItems: [{ statId: 42, points: 0.04 }, { statId: 53, points: 1 }, { statId: 24, points: 0.1 }] },
    },
  };

  function onDraftPage(settings: unknown = SETTINGS) {
    const p = page({ stored: "tok-1" });
    p.fetch.mockImplementation(async (url, init) => {
      if (url.includes("mSettings")) return new Response(JSON.stringify(settings), { status: 200 });
      if (url.includes("lm-api-reads")) return new Response(JSON.stringify({ draftDetail: { picks: [] } }), { status: 200 });
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ have: body.seq + body.frames.length }), { status: 200 });
    });
    p.load();
    return p;
  }

  it("sends only the settings War Room reads, once", async () => {
    const p = onDraftPage();
    await vi.advanceTimersByTimeAsync(300);
    console.log("BODIES", JSON.stringify(p.bodies().map((b) => Object.keys(b))));

    const sent = p.bodies().find((b) => "settings" in b) as { settings: Record<string, unknown> } | undefined;
    expect(sent?.settings).toEqual({
      // The name travels too: the pairing popup labels a league built from ESPN with it.
      name: "App Test",
      size: 4,
      draftSettings: { type: "SNAKE", pickOrder: [1, 3, 4, 2] },
      rosterSettings: { lineupSlotCounts: { "0": 1, "2": 2, "20": 3 } },
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
    });
    // Not repeated on every heartbeat.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(p.bodies().filter((b) => "settings" in b)).toHaveLength(1);
  });

  it("reads them again when the draft starts, because ESPN redraws the order at lobby time", async () => {
    const p = onDraftPage();
    await vi.advanceTimersByTimeAsync(300);
    const redrawn = { settings: { ...SETTINGS.settings, draftSettings: { type: "SNAKE", pickOrder: [2, 4, 3, 1] } } };
    p.fetch.mockImplementation(async (url, init) => {
      if (url.includes("mSettings")) return new Response(JSON.stringify(redrawn), { status: 200 });
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ have: body.seq + body.frames.length }), { status: 200 });
    });
    new (p.Socket())(DRAFT_URL).emit("STATE 1");
    await vi.advanceTimersByTimeAsync(300);
    const sent = p.bodies().filter((b) => "settings" in b) as { settings: { draftSettings: { pickOrder: number[] } } }[];
    expect(sent).toHaveLength(2);
    expect(sent[1].settings.draftSettings.pickOrder).toEqual([2, 4, 3, 1]);
  });

  it("carries on relaying picks when ESPN won't give up its settings", async () => {
    const p = page({ stored: "tok-1" });
    p.fetch.mockImplementation(async (url, init) => {
      if (url.includes("mSettings")) return new Response("nope", { status: 500 });
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ have: body.seq + body.frames.length }), { status: 200 });
    });
    p.load();
    new (p.Socket())(DRAFT_URL).emit("SELECTED 1 1 1");
    await vi.advanceTimersByTimeAsync(300);
    expect(p.bodies().some((b) => "settings" in b)).toBe(false);
    expect(p.bodies().flatMap((b) => b.frames)).toEqual(["SELECTED 1 1 1"]);
  });
});

describe("the overlay's markup", () => {
  // The overlay finds its controls with querySelector, which returns the first match. A second
  // element sharing a control's class steals its handler: that left "Connect to War Room" dead.
  it("gives every control a class nothing else in the overlay uses", () => {
    const markup = SOURCE.slice(SOURCE.indexOf("root.innerHTML = `"), SOURCE.indexOf("`;", SOURCE.indexOf("root.innerHTML = `")));
    const tokens = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
    const selected = [...SOURCE.matchAll(/root\.querySelector\("\.([\w-]+)/g)].map((m) => m[1]);
    for (const cls of new Set(selected)) expect(tokens.filter((t) => t === cls), `.${cls}`).toHaveLength(1);
  });
});

describe("handing over the join code (9.1)", () => {
  const CODE = "-342755166";
  const JOIN_URL =
    "wss://fantasydraft.espn.com/game-1/league-704343562/JOIN?1=1&2=704343562&3=1" +
    `&4=${encodeURIComponent(SWID)}&5=${encodeURIComponent(`1:704343562:1:${SWID}:${CODE}`)}&6=false&7=false&8=KONA&nocache=0.5`;
  const OFFER = { version: 1, lines: ["Let War Room join your ESPN draft room itself.", "Your ESPN draft room disconnects."] };

  function setup({ offer = true as boolean, url = JOIN_URL } = {}) {
    const p = page({ stored: "tok-1" });
    p.fetch.mockImplementation(async (u, init) => {
      if (String(u).includes("mDraftDetail")) {
        return new Response(JSON.stringify({ draftDetail: { picks: [2, 1, 3].map((teamId, i) => ({ overallPickNumber: i + 1, teamId })) } }), { status: 200 });
      }
      if (String(u).endsWith("/handover")) return new Response(JSON.stringify({ stored: true }), { status: 200 });
      if (!init || !init.body) return new Response("{}", { status: 404 });
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ have: body.seq + body.frames.length, ...(offer ? { handover: OFFER } : {}) }), { status: 200 });
    });
    p.load();
    const ws = new (p.Socket())(url);
    ws.emit(`TOKEN 1:704343562:1:${SWID}:${CODE}\n`);
    ws.emit("SELECTING 4 60000\n");
    const handovers = () =>
      p.fetch.mock.calls.filter(([u]) => String(u).endsWith("/handover")).map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>);
    const box = () => p.shadow.querySelector(".ho");
    return { ...p, ws, handovers, box };
  }

  it("offers only what War Room offers, and sends nothing until the user opts in", async () => {
    const p = setup();
    await vi.advanceTimersByTimeAsync(300);
    expect(p.box().hidden).toBe(false);
    expect(p.shadow.querySelector(".ho ul").textContent).toContain("disconnects");
    expect(p.handovers()).toHaveLength(0);
    // The bridge tells War Room it has the offer, so it isn't sent again on every check-in.
    expect(p.bodies().at(-1)!.handoverVersion).toBe(1);

    const q = setup({ offer: false });
    await vi.advanceTimersByTimeAsync(300);
    expect(q.box().hidden).toBe(true);
  });

  it("hands over the code, the SWID and who owns each pick, once, to War Room's own endpoint", async () => {
    const p = setup();
    await vi.advanceTimersByTimeAsync(300);
    p.shadow.querySelector(".ha").onclick!();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.handovers()).toEqual([expect.objectContaining({ espnLeagueId: "704343562", consentVersion: 1, code: CODE, swid: SWID, pickTeams: [2, 1, 3] })]);
    const [url, init] = p.fetch.mock.calls.find(([u]) => String(u).endsWith("/handover"))!;
    expect(url).toBe(`${WAR_ROOM}/api/espn/bridge/handover`);
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(p.bridge().handover).toBe("done");
    expect(p.storage.get("warroom-handover:704343562")).toBe("1");

    // The credential never rides in a frame post, before or after.
    p.ws.emit("SELECTED 4 4429795 2\n");
    await vi.advanceTimersByTimeAsync(300);
    const frames = JSON.stringify(p.bodies());
    expect(frames).not.toContain("342755166");
    expect(frames).not.toContain("154E132F");
  });

  it("sends nothing when the user declines", async () => {
    const p = setup();
    await vi.advanceTimersByTimeAsync(300);
    p.shadow.querySelector(".hd").onclick!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.handovers()).toHaveLength(0);
    expect(p.box().hidden).toBe(true);
  });

  it("refuses to hand over a credential for another league or team", async () => {
    const other = JOIN_URL.replace(encodeURIComponent(`1:704343562:1:`), encodeURIComponent(`1:704343562:7:`));
    const p = setup({ url: other });
    await vi.advanceTimersByTimeAsync(300);
    p.shadow.querySelector(".ha").onclick!();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.handovers()).toHaveLength(0);
    expect(p.bridge().handover).toBe("failed");
  });
});
