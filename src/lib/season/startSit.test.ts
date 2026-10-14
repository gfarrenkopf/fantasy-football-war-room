import { describe, expect, it } from "vitest";
import type { LineupPlan } from "./lineup";
import { outTag, startSitSwaps } from "./startSit";
import type { GameState } from "./scoreboard";
import type { ViewPlayer } from "./view";

const game: GameState = { state: "pre", detail: "", opponent: "NYJ", home: true, kickoff: null, period: 0, clockSeconds: 0, score: null };

const player = (playerId: number, over: Partial<ViewPlayer> = {}) =>
  ({ playerId, name: `P${playerId}`, pos: "WR", team: "DET", slot: "WR", locked: false, injuryStatus: "ACTIVE", projected: true, points: 10, game, ...over }) as ViewPlayer;

describe("outTag", () => {
  it("names a ruled-out starter's designation, a bye, and ESPN's guess that he sits", () => {
    expect(outTag(player(1, { injuryStatus: "OUT" }))).toEqual({ label: "OUT", kind: "out" });
    expect(outTag(player(1, { injuryStatus: "INJURY_RESERVE" }))).toEqual({ label: "IR", kind: "out" });
    expect(outTag(player(1, { injuryStatus: "SUSPENSION" }))).toEqual({ label: "SSPD", kind: "out" });
    expect(outTag(player(1, { points: 0, game: null }))).toEqual({ label: "BYE", kind: "out" });
    expect(outTag(player(1, { points: 0 }))).toEqual({ label: "LIKELY OUT", kind: "warn" });
  });

  it("is nothing for a player who's expected to play, questionable or not", () => {
    expect(outTag(player(1))).toBeNull();
    expect(outTag(player(1, { injuryStatus: "QUESTIONABLE" }))).toBeNull();
  });
});

describe("startSitSwaps", () => {
  it("lists only the slots that change, with the gain and why the benched player comes out", () => {
    const starter = player(1, { injuryStatus: "OUT", points: 0 });
    const benched = player(2, { slot: "BN", points: 14 });
    const keeps = player(3, { slot: "RB", pos: "RB", points: 9 });
    const plan: LineupPlan = {
      starters: [
        { key: "WR", playerId: 2, points: 14, locked: false },
        { key: "RB", playerId: 3, points: 9, locked: false },
      ],
      bench: [1],
      total: 23,
      currentTotal: 9,
      moves: [],
    };
    expect(startSitSwaps([starter, benched, keeps], plan)).toEqual([{ key: "WR", into: 2, out: 1, gain: 14, tag: { label: "OUT", kind: "out" } }]);
  });

  it("fills a slot ESPN has empty", () => {
    const benched = player(2, { slot: "BN", points: 6 });
    const plan: LineupPlan = { starters: [{ key: "WR", playerId: 2, points: 6, locked: false }], bench: [], total: 6, currentTotal: 0, moves: [] };
    expect(startSitSwaps([benched], plan)).toEqual([{ key: "WR", into: 2, out: null, gain: 6, tag: null }]);
  });
});
