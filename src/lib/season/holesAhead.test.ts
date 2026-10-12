import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/draft/types";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import type { PoolPlayer } from "./holes";
import { holesInWeek, nextWeekHoles, rankAhead, thinSlots } from "./holesAhead";
import type { ViewPlayer } from "./view";

// testView: weeks 5–7, starters QB, RB×2, WR×2, TE, FLEX, bench of three.
function roster(te: ViewPlayer, extra: ViewPlayer[] = []) {
  return [
    at("QB", player("QB", "QB", 20)),
    at("RB", player("RB1", "RB", 15)),
    at("RB", player("RB2", "RB", 12)),
    at("WR", player("WR1", "WR", 14)),
    at("WR", player("WR2", "WR", 11)),
    at("TE", te),
    at("FLEX", player("Flex WR", "WR", 9)),
    ...extra,
  ];
}

const free = (name: string, pos: Position, pts: number[], over: Partial<PoolPlayer> = {}): PoolPlayer => ({ ...player(name, pos, pts), status: "FREEAGENT", waiverClears: null, ...over });

describe("holesInWeek", () => {
  it("finds next week's bye at the only TE, and nothing this week", () => {
    const te = player("Bye TE", "TE", [8, 0, 8]);
    const view = seasonView(roster(te));
    expect(holesInWeek(view, 5)).toEqual([]);
    expect(nextWeekHoles(view)).toEqual([{ week: 6, key: "TE", playerId: te.playerId, reason: "zero" }]);
  });

  it("isn't a hole when a backup plays that week", () => {
    const view = seasonView(roster(player("Bye TE", "TE", [8, 0, 8]), [player("Backup TE", "TE", 3)]));
    expect(nextWeekHoles(view)).toEqual([]);
  });

  it("names a slot nobody on the roster can play", () => {
    const view = seasonView(roster(player("TE", "TE", 8)).filter((p) => p.pos !== "QB"));
    expect(nextWeekHoles(view)).toMatchObject([{ key: "QB", playerId: null, reason: "empty" }]);
  });
});

describe("thinSlots", () => {
  it("calls a slot thin when it's a hole in more than one week left", () => {
    expect(thinSlots(seasonView(roster(player("Gone TE", "TE", [8, 0, 0]))))).toEqual([{ key: "TE", weeks: [6, 7], of: 2 }]);
    expect(thinSlots(seasonView(roster(player("Bye TE", "TE", [8, 0, 8]))))).toEqual([]);
  });

  it("calls it thin when its player is on IR, even for one week", () => {
    const te = player("IR TE", "TE", [0, 0, 9], { injuryStatus: "INJURY_RESERVE" });
    expect(thinSlots(seasonView(roster(te)))).toEqual([{ key: "TE", weeks: [6], of: 2 }]);
  });
});

describe("rankAhead", () => {
  it("ranks pickups by that week's points, with a drop from the bench when the roster is full", () => {
    const te = player("Bye TE", "TE", [8, 0, 8]);
    const bench = [player("Bench RB", "RB", 6), player("Bench WR", "WR", 4), player("Bench WR2", "WR", 3)];
    const view = seasonView(roster(te, bench));
    const [next] = rankAhead(view, nextWeekHoles(view), [free("Streamer", "TE", [2, 9, 2]), free("Stash", "TE", [7, 6, 7]), free("A WR", "WR", [20, 20, 20])]);
    expect(next.fills.map((f) => f.player.name)).toEqual(["Streamer", "Stash"]);
    expect(next.fills[0].drop).toBe(bench[2].playerId);
  });
});
