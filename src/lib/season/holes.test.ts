import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/draft/types";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { findHoles, holeSlots, rankFills, type PoolPlayer } from "./holes";
import type { GameState } from "./scoreboard";
import type { ViewPlayer } from "./view";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const ONE = "2026-10-11T17:00:00Z";
const NIGHT = "2026-10-12T00:20:00Z";

const game = (kickoff: string, state: GameState["state"] = "pre"): GameState => ({ state, detail: "", opponent: "ATL", home: false, kickoff, period: 0, clockSeconds: 0, score: null });

/** A starter or bench player with a game at 1pm unless told otherwise. */
const p = (name: string, pos: Position, pts: number | number[], over: Partial<ViewPlayer> = {}) => player(name, pos, pts, { game: game(ONE), ...over });

/** Starters QB, RB×2, WR×2, TE, FLEX and a bench of three: a full roster of ten. */
function roster(qb: ViewPlayer, extra: { te?: ViewPlayer; bench?: ViewPlayer[] } = {}) {
  return [
    at("QB", qb),
    at("RB", p("RB1", "RB", 15)),
    at("RB", p("RB2", "RB", 12)),
    at("WR", p("WR1", "WR", 14)),
    at("WR", p("WR2", "WR", 11)),
    at("TE", extra.te ?? p("TE1", "TE", 8)),
    at("FLEX", p("Flex WR", "WR", 9)),
    ...(extra.bench ?? [p("Bench RB", "RB", 6), p("Bench WR", "WR", 5), p("Bench WR2", "WR", 4)]),
  ];
}

const free = (name: string, pos: Position, pts: number | number[], over: Partial<PoolPlayer> = {}): PoolPlayer => ({
  ...p(name, pos, pts),
  status: "FREEAGENT",
  waiverClears: null,
  ...over,
});

describe("findHoles", () => {
  it("finds the only QB ruled out, which the lineup can't fix", () => {
    const lamar = p("Lamar", "QB", 0, { injuryStatus: "OUT", game: game(NIGHT) });
    expect(findHoles(seasonView(roster(lamar)))).toEqual([{ key: "QB", kind: "hard", reason: "out", playerId: lamar.playerId, kickoff: NIGHT }]);
  });

  it("finds the only TE on a bye", () => {
    const te = p("Bye TE", "TE", [0, 9, 9], { game: null });
    expect(findHoles(seasonView(roster(p("QB", "QB", 20), { te })))).toMatchObject([{ key: "TE", kind: "hard", reason: "bye", kickoff: null }]);
  });

  it("isn't a hole when the bench can fill it: that's a swap", () => {
    const out = p("Out QB", "QB", 0, { injuryStatus: "OUT" });
    const view = seasonView(roster(out, { bench: [p("Backup QB", "QB", 14), p("Bench WR", "WR", 5), p("Bench WR2", "WR", 4)] }));
    expect(findHoles(view)).toEqual([]);
  });

  it("finds an empty slot nobody on the roster can play", () => {
    const view = seasonView(roster(p("QB", "QB", 20)).filter((x) => x.pos !== "TE"));
    expect(findHoles(view)).toMatchObject([{ key: "TE", kind: "hard", reason: "empty", playerId: null }]);
  });

  it("marks a player ESPN expects to sit, or a DOUBTFUL one with no backup, as soft, after the hard ones", () => {
    const qb = p("Out QB", "QB", 0, { injuryStatus: "OUT" });
    const te = p("Likely out TE", "TE", 0);
    expect(findHoles(seasonView(roster(qb, { te }))).map((h) => [h.key, h.kind, h.reason])).toEqual([
      ["QB", "hard", "out"],
      ["TE", "soft", "likely-out"],
    ]);
    const doubtful = p("Doubtful QB", "QB", 12, { injuryStatus: "DOUBTFUL" });
    expect(findHoles(seasonView(roster(doubtful)))).toMatchObject([{ key: "QB", kind: "soft", reason: "doubtful" }]);
    const covered = seasonView(roster(doubtful, { bench: [p("Backup QB", "QB", 8), p("Bench WR", "WR", 5), p("Bench WR2", "WR", 4)] }));
    expect(findHoles(covered)).toEqual([]);
  });

  it("leaves a slot alone once its game has started", () => {
    const qb = p("Out QB", "QB", 0, { injuryStatus: "OUT", game: game(ONE, "in"), locked: true });
    expect(findHoles(seasonView(roster(qb)))).toEqual([]);
  });
});

describe("rankFills", () => {
  /** Out this week, back after it. */
  const lamar = p("Lamar", "QB", [0, 25, 25], { injuryStatus: "OUT", game: game(NIGHT) });

  it("ranks free agents by this week's points, and keeps claims that clear in time apart", () => {
    const view = seasonView(roster(lamar));
    const streamer = free("Streamer", "QB", [17, 10, 10]);
    const stash = free("Stash", "QB", [15, 20, 20]);
    const playing = free("Playing", "QB", 25, { game: game(ONE, "in") });
    const late = free("Late claim", "QB", 30, { status: "WAIVERS", waiverClears: "2026-10-13T08:00:00Z" });
    const timely = free("Timely claim", "QB", 30, { status: "WAIVERS", waiverClears: "2026-10-11T15:00:00Z" });
    const [qb] = rankFills(view, findHoles(view), [stash, playing, late, timely, streamer, free("A WR", "WR", 30)], NOW);
    expect(qb.fills.map((f) => f.player.name)).toEqual(["Streamer", "Stash"]);
    expect(qb.claims.map((f) => f.player.name)).toEqual(["Timely claim"]);
  });

  it("makes room with IR when the hole's player qualifies and a spot is open", () => {
    const view = seasonView(roster(lamar));
    const [qb] = rankFills(view, findHoles(view), [free("Streamer", "QB", 17)], NOW);
    expect(qb.fills[0]).toMatchObject({ drop: null, ir: lamar.playerId });
  });

  it("drops from the bench by the shared rule, never a starter, when IR can't help", () => {
    const view = { ...seasonView(roster(lamar)), irSlots: 0 };
    const [qb] = rankFills(view, findHoles(view), [free("Streamer", "QB", 17)], NOW);
    expect(qb.fills[0]).toMatchObject({ ir: null, drop: view.teams[0].roster.find((x) => x.name === "Bench WR2")!.playerId });
  });

  it("cuts the hole's own player only when that does more for the rest of the season", () => {
    const done = p("Done for the year", "QB", 0, { injuryStatus: "INJURY_RESERVE" });
    const view = { ...seasonView(roster(done)), irSlots: 0 };
    const [qb] = rankFills(view, findHoles(view), [free("Streamer", "QB", 17)], NOW);
    expect(qb.fills[0].drop).toBe(done.playerId);
    const lamarView = { ...seasonView(roster(p("Lamar", "QB", [0, 25, 25], { injuryStatus: "OUT" }))), irSlots: 0 };
    const [kept] = rankFills(lamarView, findHoles(lamarView), [free("Streamer", "QB", 17)], NOW);
    expect(kept.fills[0].drop).toBe(lamarView.teams[0].roster.find((x) => x.name === "Bench WR2")!.playerId);
  });

  it("fills two holes with different players and different drops", () => {
    const te = p("Bye TE", "TE", [0, 9, 9], { game: null });
    const view = { ...seasonView(roster(lamar, { te })), irSlots: 0 };
    const holes = findHoles(view);
    const [qb, tight] = rankFills(view, holes, [free("Streamer", "QB", 17), free("Stream TE", "TE", 7), free("Other TE", "TE", 6)], NOW);
    expect(qb.fills[0].player.name).toBe("Streamer");
    expect(tight.fills[0].player.name).toBe("Stream TE");
    expect(tight.fills[0].drop).not.toBe(qb.fills[0].drop);
    expect(holeSlots(holes)).toBe("QB and TE");
  });

  it("offers nothing when nobody available can play in time", () => {
    const view = seasonView(roster(lamar));
    const [qb] = rankFills(view, findHoles(view), [free("Playing", "QB", 25, { game: game(ONE, "post") })], NOW);
    expect(qb).toMatchObject({ fills: [], claims: [] });
  });
});
