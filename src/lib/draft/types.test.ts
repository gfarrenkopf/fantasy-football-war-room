import { describe, expect, it } from "vitest";
import type { LeagueSettings, Player } from "./types";
import { LATE_POSITIONS, POSITIONS } from "./types";

// Covers every field the prototype's player card (cardHtml) and roster panel (renderRoster) read.
const gibbs: Player = {
  id: "jahmyr-gibbs-rb-det",
  name: "Jahmyr Gibbs",
  pos: "RB",
  team: "DET",
  bye: 6,
  consensusRank: 1,
  adp: 1,
  posRank: 1,
  note: "Pacheco to IR: even more volume",
};

const twelveTeamPpr: LeagueSettings = {
  teams: 12,
  mySlot: 1,
  scoring: "ppr",
  valueThreshold: 10,
  roster: [
    { key: "QB", eligible: ["QB"] },
    { key: "RB", eligible: ["RB"] },
    { key: "RB", eligible: ["RB"] },
    { key: "WR", eligible: ["WR"] },
    { key: "WR", eligible: ["WR"] },
    { key: "TE", eligible: ["TE"] },
    { key: "FLEX", eligible: ["RB", "WR", "TE"] },
    { key: "DST", eligible: ["DST"] },
    { key: "K", eligible: ["K"] },
    ...Array.from({ length: 7 }, () => ({ key: "BN" as const, eligible: [] })),
  ],
};

describe("core types", () => {
  it("model the prototype's league without hardcoding it", () => {
    expect(twelveTeamPpr.roster).toHaveLength(16);
    expect(gibbs.adp - gibbs.consensusRank).toBe(0);
  });

  it("list every position, with K and DST as late positions", () => {
    expect(POSITIONS).toEqual(["QB", "RB", "WR", "TE", "K", "DST"]);
    expect(LATE_POSITIONS.every((p) => POSITIONS.includes(p))).toBe(true);
  });
});
