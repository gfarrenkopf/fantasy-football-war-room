import { describe, expect, it, vi } from "vitest";
import type { Crosswalk } from "@/lib/espn/crosswalk";
import type { LiveEvent } from "@/lib/espn/live";
import { createRelay, type RelayScope } from "./relay";

/** Players 1 and 2 are on the board; everything else is off it. */
const crosswalk: Crosswalk = (id) =>
  id === 1 || id === 2 ? { kind: "matched", playerId: `p${id}` } : { kind: "offBoard", player: { name: `ESPN ${id}`, pos: "RB", team: "DET" } };
const fallback: Crosswalk = (id) => ({ kind: "offBoard", player: { name: `ESPN player ${id}`, pos: null, team: null } });

function setup(opts: { crosswalkFor?: (season: number) => Promise<Crosswalk> } = {}) {
  let t = 1_000_000;
  const crosswalkFor = vi.fn(opts.crosswalkFor ?? (async () => crosswalk));
  const relay = createRelay({ now: () => t, crosswalkFor, fallbackCrosswalk: fallback });
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
});
