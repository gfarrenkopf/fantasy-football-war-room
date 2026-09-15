import { describe, expect, it } from "vitest";
import type { Player } from "./types";
import { valueTag, valueTagLabel } from "./value";

// [name, pos, consensusRank (prototype ECR), adp (prototype ESPN)], from prototype/war_room.html RAW.
type Row = [string, Player["pos"], number, number];
const player = ([, pos, consensusRank, adp]: Row) => ({ pos, consensusRank, adp });

describe("valueTag reproduces the prototype's tags", () => {
  const cases: [Row, string][] = [
    [["Chris Godwin", "WR", 82, 128], "+46 Value"],
    [["Jaylen Warren", "RB", 70, 96], "+26 Value"],
    [["Quentin Johnston", "WR", 85, 113], "+28 Value"],
    [["Jared Goff", "QB", 112, 136], "+24 Value"],
    [["Travis Hunter", "WR", 200, 91], "-109 Reach Risk"],
    [["Jeremiyah Love", "RB", 33, 15], "-18 Reach Risk"],
    [["Rashee Rice", "WR", 28, 16], "-12 Reach Risk"],
    [["Jayden Daniels", "QB", 72, 55], "-17 Reach Risk"],
    [["Jahmyr Gibbs", "RB", 1, 1], "0"],
    [["A.J. Brown", "WR", 19, 28], "+9"],
    [["Drake London", "WR", 20, 14], "-6"],
  ];

  it.each(cases)("%s → %s", (row, label) => {
    expect(valueTagLabel(valueTag(player(row)))).toBe(label);
  });
});

describe("threshold boundaries", () => {
  it("exactly ±threshold is tagged, one inside is not", () => {
    expect(valueTag({ pos: "WR", consensusRank: 50, adp: 60 }).kind).toBe("value");
    expect(valueTag({ pos: "WR", consensusRank: 50, adp: 59 }).kind).toBe("even");
    expect(valueTag({ pos: "WR", consensusRank: 50, adp: 40 }).kind).toBe("reach");
    expect(valueTag({ pos: "WR", consensusRank: 50, adp: 41 }).kind).toBe("even");
  });

  it("uses a configurable threshold", () => {
    const nabers = { pos: "WR" as const, consensusRank: 26, adp: 29 };
    expect(valueTag(nabers).kind).toBe("even");
    expect(valueTag(nabers, 3).kind).toBe("value");
  });
});

describe("K and D/ST", () => {
  it("are never tagged, even with a large gap", () => {
    const aubrey = valueTag({ pos: "K", consensusRank: 135, adp: 142 });
    const texans = valueTag({ pos: "DST", consensusRank: 145, adp: 200 });
    expect(aubrey).toEqual({ kind: "na", delta: 7 });
    expect(texans.kind).toBe("na");
    expect(valueTagLabel(texans)).toBe("");
  });
});
