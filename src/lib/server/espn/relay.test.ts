import { describe, expect, it, vi } from "vitest";
import type { Crosswalk } from "@/lib/espn/crosswalk";
import type { LiveEvent } from "@/lib/espn/live";
import { createRelay, queueFromPlan, type RelayScope } from "./relay";

/** Players 1 and 2 are on the board; everything else is off it. */
const crosswalk: Crosswalk = (id) =>
  id === 1 || id === 2 ? { kind: "matched", playerId: `p${id}` } : { kind: "offBoard", player: { name: `ESPN ${id}`, pos: "RB", team: "DET" } };
const fallback: Crosswalk = (id) => ({ kind: "offBoard", player: { name: `ESPN player ${id}`, pos: null, team: null } });

function setup(opts: { crosswalkFor?: (season: number) => Promise<Crosswalk> } = {}) {
  let t = 1_000_000;
  let ids = 0;
  const crosswalkFor = vi.fn(opts.crosswalkFor ?? (async () => crosswalk));
  const relay = createRelay({ now: () => t, crosswalkFor, fallbackCrosswalk: fallback, newId: () => `r${++ids}` });
  const events: LiveEvent[] = [];
  const advance = (ms: number) => (t += ms);
  return { relay, events, advance, crosswalkFor };
}

const scope: RelayScope = { userId: "u1", leagueId: "L1", espnLeagueId: "704343562", espnTeamId: 1, season: 2026 };
const PRE = ["CLOCK 0 5000", "STATE 1", "SELECTING 4 60000"];

describe("relay", () => {
  it("starts waiting, then streams resolved picks to a subscriber", async () => {
    const { relay, events } = setup();
    const { snapshot } = relay.subscribe("u1", "L1", (e) => events.push(e));
    expect(snapshot).toMatchObject({ status: "waiting", picks: [], espnTeamId: null });

    expect(await relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2", "SELECTING 1 60000"])).toEqual({ status: 200, have: 5 });
    expect(await relay.ingest(scope, "s1", 5, ["SELECTED 1 999 4 {00000000-0000-0000-0000-000000000000}"])).toEqual({ status: 200, have: 6 });

    const picks = events.flatMap((e) => (e.type === "pick" ? [e.pick] : []));
    expect(picks).toEqual([
      { n: 1, teamId: 4, mine: false, auto: true, espnPlayerId: 1, playerId: "p1", offBoard: null },
      { n: 2, teamId: 1, mine: true, auto: false, espnPlayerId: 999, playerId: null, offBoard: { name: "ESPN 999", pos: "RB", team: "DET" } },
    ]);
    expect(events).toContainEqual({ type: "status", status: "live", draft: "live" });
    expect(events).toContainEqual({ type: "clock", onClock: { teamId: 1, msRemaining: 60000 } });
    expect(relay.snapshot("u1", "L1")).toMatchObject({ status: "live", anchored: true, espnTeamId: 1, sessions: 1 });
  });

  it("takes the time since the last clock frame off a snapshot's clock", async () => {
    const { relay, advance, events } = setup();
    relay.subscribe("u1", "L1", (e) => events.push(e));
    await relay.ingest(scope, "s1", 0, [...PRE, "CLOCK 6 30000 4"]);
    advance(3_000);
    expect(relay.snapshot("u1", "L1").onClock).toEqual({ teamId: 4, msRemaining: 27_000 });
    advance(60_000);
    expect(relay.snapshot("u1", "L1").onClock).toEqual({ teamId: 4, msRemaining: 0 });

    // A repeated clock (a paused draft) still restarts the countdown and reaches listeners.
    await relay.ingest(scope, "s1", 4, ["CLOCK 6 30000 4"]);
    expect(relay.snapshot("u1", "L1").onClock).toEqual({ teamId: 4, msRemaining: 30_000 });
    expect(events.filter((e) => e.type === "clock").at(-1)).toEqual({ type: "clock", onClock: { teamId: 4, msRemaining: 30_000 } });
  });

  it("answers a frame offset it doesn't hold with 409 and the count it has", async () => {
    const { relay } = setup();
    await relay.ingest(scope, "s1", 0, PRE);
    expect(await relay.ingest(scope, "s1", 10, ["SELECTED 4 1 2"])).toEqual({ status: 409, have: 3 });
    expect(await relay.ingest(scope, "s1", 3, ["SELECTED 4 1 2"])).toEqual({ status: 200, have: 4 });
  });

  it("rebuilds from a bridge's full resend after losing everything (a restart)", async () => {
    const first = setup();
    await first.relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2"]);
    const restarted = setup();
    expect(await restarted.relay.ingest(scope, "s1", 5, ["SELECTED 1 2 4"])).toEqual({ status: 409, have: 0 });
    await restarted.relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2", "SELECTED 1 2 4"]);
    expect(restarted.relay.snapshot("u1", "L1").picks.map((p) => p.playerId)).toEqual(["p1", "p2"]);
  });

  it("continues the draft across a reloaded ESPN tab (a new session)", async () => {
    const { relay } = setup();
    await relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2"]);
    await relay.ingest(scope, "s2", 0, ["INIT", "TOKEN", "SELECTING 3 60000", "SELECTED 3 2 4"]);
    const snap = relay.snapshot("u1", "L1");
    expect(snap.picks.map((p) => [p.n, p.playerId])).toEqual([
      [1, "p1"],
      [2, "p2"],
    ]);
    expect(snap.sessions).toBe(2);
  });

  it("goes offline when the bridge stops checking in, and back when it returns", async () => {
    const { relay, events, advance } = setup();
    relay.subscribe("u1", "L1", (e) => events.push(e));
    await relay.ingest(scope, "s1", 0, PRE);
    advance(21_000);
    relay.checkStatus("u1", "L1");
    expect(events.at(-1)).toEqual({ type: "status", status: "bridge-offline", draft: "live" });
    await relay.ingest(scope, "s1", 3, []); // a heartbeat
    expect(events.at(-1)).toEqual({ type: "status", status: "live", draft: "live" });
  });

  it("reports the draft complete", async () => {
    const { relay, events } = setup();
    relay.subscribe("u1", "L1", (e) => events.push(e));
    await relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2", "STATE 2"]);
    expect(events.at(-1)).toEqual({ type: "status", status: "complete", draft: "complete" });
  });

  it("starts over when the league is paired to a different ESPN league", async () => {
    const { relay } = setup();
    await relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2"]);
    await relay.ingest({ ...scope, espnLeagueId: "111" }, "s9", 0, PRE);
    expect(relay.snapshot("u1", "L1").picks).toEqual([]);
  });

  it("keeps each user's leagues apart", async () => {
    const { relay } = setup();
    await relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2"]);
    expect(relay.snapshot("u2", "L1").picks).toEqual([]);
    expect(relay.snapshot("u1", "L2").picks).toEqual([]);
  });

  it("names picks unnamed rather than failing when ESPN's player list is unavailable, and retries later", async () => {
    let calls = 0;
    const { relay, crosswalkFor } = setup({
      crosswalkFor: async () => {
        calls++;
        if (calls === 1) throw new Error("ESPN down");
        return crosswalk;
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2"]);
    expect(relay.snapshot("u1", "L1").picks[0]).toMatchObject({ playerId: null, offBoard: { name: "ESPN player 1" } });
    await relay.ingest(scope, "s1", 4, ["SELECTED 1 2 4"]);
    expect(relay.snapshot("u1", "L1").picks[1]).toMatchObject({ playerId: "p2" });
    expect(crosswalkFor).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("marks the user's picks again when the bridge reports a different team", async () => {
    const { relay, events } = setup();
    relay.subscribe("u1", "L1", (e) => events.push(e));
    await relay.ingest({ ...scope, espnTeamId: 2 }, "s1", 0, [...PRE, "SELECTED 4 1 2"]);
    expect(relay.snapshot("u1", "L1").picks[0].mine).toBe(false);
    await relay.ingest({ ...scope, espnTeamId: 4 }, "s1", 4, []);
    expect(relay.snapshot("u1", "L1").picks[0].mine).toBe(true);
    expect(events.at(-1)?.type === "snapshot" || events.some((e) => e.type === "snapshot")).toBe(true);
  });

  it("stops telling a listener once it unsubscribes", async () => {
    const { relay, events } = setup();
    const { unsubscribe } = relay.subscribe("u1", "L1", (e) => events.push(e));
    unsubscribe();
    await relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2"]);
    expect(events).toEqual([]);
  });

  it("refuses a runaway bridge", async () => {
    const relay = createRelay({ crosswalkFor: async () => crosswalk, fallbackCrosswalk: fallback, maxFrames: 3 });
    expect(await relay.ingest(scope, "s1", 0, ["CLOCK 0 1", "CLOCK 0 2", "CLOCK 0 3", "CLOCK 0 4"])).toEqual({ status: 413 });
  });

  describe("picks made from War Room", () => {
    const ME = "{00000000-0000-0000-0000-000000000000}";
    /** The draft with the user's team (1) on the clock. */
    async function onTheClock() {
      const ctx = setup();
      ctx.relay.subscribe("u1", "L1", (e) => ctx.events.push(e));
      await ctx.relay.ingest(scope, "s1", 0, [...PRE, "SELECTED 4 1 2", "SELECTING 1 60000"]);
      return ctx;
    }
    const requests = (events: LiveEvent[]) => events.flatMap((e) => (e.type === "request" ? [e.request] : []));

    it("hands the pick to the bridge on its next check-in, and confirms it when ESPN announces it", async () => {
      const { relay, events } = await onTheClock();
      expect(relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 })).toEqual({
        ok: true,
        request: { id: "r1", playerId: "p2", espnPlayerId: 2, state: "pending" },
      });
      expect(await relay.ingest(scope, "s1", 5, [])).toEqual({ status: 200, have: 5, command: { id: "r1", select: 2 } });
      await relay.ingest(scope, "s1", 5, [], { id: "r1", sent: true });
      expect(await relay.ingest(scope, "s1", 5, [`SELECTED 1 2 4 ${ME}`])).toEqual({ status: 200, have: 6 });
      expect(requests(events).map((r) => r.state)).toEqual(["pending", "sent", "confirmed"]);
      expect(relay.snapshot("u1", "L1").request).toMatchObject({ id: "r1", state: "confirmed" });
    });

    it("refuses unless ESPN has the user on the clock, the player is available, and the bridge is live", async () => {
      const fresh = setup();
      expect(fresh.relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 })).toEqual({ ok: false, reason: "no-bridge" });
      await fresh.relay.ingest(scope, "s1", 0, [...PRE]); // team 4 on the clock
      expect(fresh.relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 })).toEqual({ ok: false, reason: "not-your-turn" });

      const { relay, advance } = await onTheClock();
      expect(relay.requestPick("u1", "L1", { playerId: "p1", espnPlayerId: 1 })).toEqual({ ok: false, reason: "taken" });
      expect(relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 }).ok).toBe(true);
      expect(relay.requestPick("u1", "L1", { playerId: "x", espnPlayerId: 3 })).toEqual({ ok: false, reason: "busy" });
      advance(25_000);
      expect(relay.requestPick("u1", "L1", { playerId: "x", espnPlayerId: 3 })).toEqual({ ok: false, reason: "bridge-offline" });
    });

    it("never hands the bridge a pick that has waited too long to be delivered", async () => {
      const { relay, advance } = await onTheClock();
      relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 });
      advance(6_000);
      expect(await relay.ingest(scope, "s1", 5, [])).toEqual({ status: 200, have: 5 });
    });

    it("expires a pick ESPN never confirmed", async () => {
      const { relay, events, advance } = await onTheClock();
      relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 });
      await relay.ingest(scope, "s1", 5, [], { id: "r1", sent: true });
      advance(11_000);
      await relay.ingest(scope, "s1", 5, []);
      expect(requests(events).at(-1)).toMatchObject({ id: "r1", state: "expired" });
    });

    it("reports a pick the bridge refused to send, with its reason", async () => {
      const { relay, events } = await onTheClock();
      relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 });
      await relay.ingest(scope, "s1", 5, [], { id: "r1", sent: false, reason: "not-on-the-clock" });
      expect(requests(events).at(-1)).toEqual({ id: "r1", playerId: "p2", espnPlayerId: 2, state: "refused", reason: "not-on-the-clock" });
      expect(await relay.ingest(scope, "s1", 5, [])).toEqual({ status: 200, have: 5 });
    });

    it("is superseded when the user's team picks someone else first", async () => {
      const { relay, events } = await onTheClock();
      relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 });
      await relay.ingest(scope, "s1", 5, ["AUTODRAFT 1 true", "SELECTED 1 999 4"]);
      expect(requests(events).at(-1)).toMatchObject({ state: "superseded" });
    });

    it("ignores a result for a request that isn't current", async () => {
      const { relay } = await onTheClock();
      relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 });
      await relay.ingest(scope, "s1", 5, [], { id: "old", sent: false });
      expect(relay.snapshot("u1", "L1").request?.state).toBe("pending");
    });
  });

  describe("the overlay's turn plan", () => {
    const plan = { picks: [5], rounds: "2", onClock: false, targets: [], fallbacks: [], best: [], after: null };

    it("keeps the latest published plan and hands it to a bridge only when its copy is older", async () => {
      const { relay } = setup();
      expect(relay.publishPlan("u1", "L1", plan)).toBe(false); // no bridge yet
      await relay.ingest(scope, "s1", 0, PRE);
      expect(relay.publishPlan("u1", "L1", plan)).toBe(true);
      expect(await relay.ingest(scope, "s1", 3, [], undefined, 0)).toEqual({ status: 200, have: 3, plan: { version: 1, plan } });
      expect(await relay.ingest(scope, "s1", 3, [], undefined, 1)).toEqual({ status: 200, have: 3 });
      relay.publishPlan("u1", "L1", { ...plan, picks: [8] });
      expect(await relay.ingest(scope, "s1", 3, [], undefined, 1)).toMatchObject({ plan: { version: 2, plan: { picks: [8] } } });
    });
  });
});

describe("ESPN's own league settings (8.8)", () => {
  const SETTINGS = {
    size: 4,
    draftSettings: { type: "SNAKE", pickOrder: [4, 1, 3, 2] },
    rosterSettings: { lineupSlotCounts: { "0": 1, "2": 2, "4": 2, "20": 3 } },
    scoringSettings: { scoringItems: [{ statId: 53, points: 0.5 }] },
  };

  it("maps them for the war room, and repeats itself only when they change", async () => {
    const { relay, events } = setup();
    const { snapshot } = relay.subscribe("u1", "L1", (e) => events.push(e));
    expect(snapshot.espnLeague).toBeNull();

    relay.setLeague(scope, SETTINGS);
    // scope's team is 1, second in the pick order.
    expect(relay.snapshot("u1", "L1").espnLeague).toEqual({ ok: true, settings: { teams: 4, mySlot: 2, scoring: "half", roster: expect.any(Array) } });
    expect(events.filter((e) => e.type === "league")).toHaveLength(1);

    relay.setLeague(scope, SETTINGS);
    expect(events.filter((e) => e.type === "league")).toHaveLength(1);

    // The lobby opening redraws the order, which moves the user's slot.
    relay.setLeague(scope, { ...SETTINGS, draftSettings: { type: "SNAKE", pickOrder: [1, 4, 3, 2] } });
    expect(events.filter((e) => e.type === "league").at(-1)).toMatchObject({ espnLeague: { ok: true, settings: { mySlot: 1 } } });
  });

  it("passes on a refusal rather than a half-built league", async () => {
    const { relay } = setup();
    relay.setLeague(scope, { ...SETTINGS, draftSettings: { type: "AUCTION", pickOrder: [1] } });
    expect(relay.snapshot("u1", "L1").espnLeague).toEqual({ ok: false, error: "War Room doesn't do auction drafts yet." });
  });

  it("forgets them when the bridge pairs to a different ESPN league", async () => {
    const { relay } = setup();
    await relay.ingest(scope, "s1", 0, ["STATE 1"]);
    relay.setLeague(scope, SETTINGS);
    expect(relay.snapshot("u1", "L1").espnLeague).toMatchObject({ ok: true });

    // A different ESPN draft: the channel resets, and its settings go with it. The route sets the
    // new league after ingest, which is the order this asserts.
    await relay.ingest({ ...scope, espnLeagueId: "999" }, "s2", 0, ["STATE 1"]);
    expect(relay.snapshot("u1", "L1").espnLeague).toBeNull();
  });
});

describe("when ESPN's protocol drifts (8.6)", () => {
  const junk = (n: number) => Array.from({ length: n }, (_, i) => `WHAT_IS_THIS ${i}`);

  it("keeps going through a few frames it can't read", async () => {
    const { relay, events } = setup();
    relay.subscribe("u1", "L1", (e) => events.push(e));
    await relay.ingest(scope, "s1", 0, [...PRE, ...junk(5), "SELECTED 4 1 2"]);
    expect(relay.snapshot("u1", "L1").degraded).toBeNull();
    expect(relay.snapshot("u1", "L1").picks).toHaveLength(1);
  });

  it("stops trusting the feed once they pile up, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { relay, events } = setup();
    relay.subscribe("u1", "L1", (e) => events.push(e));
    await relay.ingest(scope, "s1", 0, [...PRE, ...junk(20)]);

    const degraded = relay.snapshot("u1", "L1").degraded;
    expect(degraded).toMatchObject({ reason: expect.stringContaining("changed"), unknownFrames: 20 });
    expect(events.filter((e) => e.type === "degraded")).toHaveLength(1);
    // The log line is what deploy/warroom-alerts.sh emails on.
    expect(warn.mock.calls[0][0]).toContain("[espn-sync] protocol-drift");
    expect(warn.mock.calls[0][0]).toContain("league=704343562");

    await relay.ingest(scope, "s1", 23, junk(20));
    expect(events.filter((e) => e.type === "degraded")).toHaveLength(1);
    warn.mockRestore();
  });

  it("treats ESPN refusing the socket as drift too, and quotes it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { relay } = setup();
    await relay.ingest(scope, "s1", 0, ["ERROR 1 Invalid+security+code%3B+access+is+refused."]);
    expect(relay.snapshot("u1", "L1").degraded?.reason).toBe("ESPN refused the draft connection: Invalid security code; access is refused.");
    warn.mockRestore();
  });

  it("forgets it when the bridge moves to a different ESPN draft", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { relay } = setup();
    await relay.ingest(scope, "s1", 0, junk(25));
    expect(relay.snapshot("u1", "L1").degraded).not.toBeNull();
    await relay.ingest({ ...scope, espnLeagueId: "999" }, "s2", 0, ["STATE 1"]);
    expect(relay.snapshot("u1", "L1").degraded).toBeNull();
    warn.mockRestore();
  });
});

describe("relay with War Room holding the ESPN connection (9.3)", () => {
  const player = (espnPlayerId: number | undefined, name = `P${espnPlayerId}`) => ({ playerId: name, espnPlayerId, name, pos: "RB" as const, team: "DET", bye: 8, badge: "90%" });
  const plan = {
    picks: [5],
    rounds: "1",
    onClock: true,
    targets: [player(11), player(12)],
    fallbacks: [player(12), player(undefined, "nobody"), player(13)],
    best: [player(1), player(14)],
    after: null,
  };

  async function holding() {
    const s = setup();
    const sender = { select: vi.fn(() => true), setQueue: vi.fn(() => true) };
    s.relay.attachSender("u1", "L1", sender);
    s.relay.subscribe("u1", "L1", (e) => s.events.push(e));
    await s.relay.ingest(scope, "srv1", 0, [...PRE, "SELECTED 4 1 2", "SELECTING 1 60000"]);
    return { ...s, sender };
  }

  it("sends a War Room pick on ESPN's socket at once, and ESPN's echo confirms it", async () => {
    const { relay, sender, events } = await holding();
    const result = relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 });
    expect(result).toMatchObject({ ok: true, request: { state: "sent" } });
    expect(sender.select).toHaveBeenCalledWith(2);
    // Nothing is left for a bridge to carry.
    expect(((await relay.ingest(scope, "srv1", 5, [])) as { command?: unknown }).command).toBeUndefined();
    await relay.ingest(scope, "srv1", 5, ["SELECTED 1 2 4 {00000000-0000-0000-0000-000000000000}"]);
    expect(events.filter((e) => e.type === "request").map((e) => e.type === "request" && e.request.state)).toEqual(["pending", "sent", "confirmed"]);
  });

  it("settles an out-of-turn refusal as refused, without calling the feed untrustworthy", async () => {
    const { relay } = await holding();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 });
    await relay.ingest(scope, "srv1", 5, ["ERROR 1 Invalid+selection+team+%281%29%3B+team+4+is+currently+on+the+clock."]);
    const snap = relay.snapshot("u1", "L1");
    expect(snap.request).toMatchObject({ state: "refused", reason: "not-on-the-clock" });
    expect(snap.degraded).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to the bridge's check-in when the socket couldn't send", async () => {
    const { relay, sender } = await holding();
    sender.select.mockReturnValue(false);
    expect(relay.requestPick("u1", "L1", { playerId: "p2", espnPlayerId: 2 })).toMatchObject({ ok: true, request: { state: "pending" } });
    expect(((await relay.ingest(scope, "srv1", 5, [])) as { command?: unknown }).command).toEqual({ id: "r1", select: 2 });
  });

  it("queues the turn plan in ESPN: targets, fallbacks, then best, each once, none drafted", () => {
    expect(queueFromPlan(plan, new Set([1]))).toEqual([11, 12, 13, 14]);
  });

  it("sets ESPN's queue only when asked, and keeps it in step with new plans while syncing", async () => {
    const { relay, sender } = await holding();
    relay.publishPlan("u1", "L1", plan);
    expect(sender.setQueue).not.toHaveBeenCalled(); // never silently

    expect(relay.pushQueue("u1", "L1")).toEqual([11, 12, 13, 14]);
    expect(sender.setQueue).toHaveBeenCalledTimes(1);

    relay.setServerClient("u1", "L1", { state: "holding" });
    relay.setQueueSync("u1", "L1", true);
    expect(relay.serverClient("u1", "L1")).toEqual({ state: "holding", queueSync: true });
    relay.publishPlan("u1", "L1", { ...plan, targets: [player(15)] });
    expect(sender.setQueue).toHaveBeenLastCalledWith([15, 12, 13, 14]);
    const calls = sender.setQueue.mock.calls.length;
    relay.publishPlan("u1", "L1", { ...plan, targets: [player(15)] }); // unchanged: not sent again
    expect(sender.setQueue).toHaveBeenCalledTimes(calls);

    // Losing the connection ends syncing.
    relay.setServerClient("u1", "L1", { state: "lost", reason: "gone" });
    expect(relay.serverClient("u1", "L1")).toEqual({ state: "lost", reason: "gone" });
  });

  it("won't sync a queue with nothing holding the connection", () => {
    const { relay } = setup();
    expect(relay.setQueueSync("u1", "L1", true)).toBeNull();
    expect(relay.pushQueue("u1", "L1")).toBeNull();
  });
});
