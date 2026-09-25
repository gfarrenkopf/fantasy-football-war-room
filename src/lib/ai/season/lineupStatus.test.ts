import { describe, expect, it } from "vitest";
import type { AiLineup } from "./lineup";
import { aiLineupStatus, espnStartersOf } from "./lineupStatus";

const lineup = (espnStarters?: number[]): AiLineup => ({
  intro: "Close calls at FLEX.",
  slots: [
    { key: "QB", playerId: 1, enginePlayerId: 1, locked: false, reason: null },
    { key: "FLEX", playerId: 3, enginePlayerId: 2, locked: false, reason: "Upside." },
  ],
  total: 30,
  ...(espnStarters ? { espnStarters } : {}),
});

describe("aiLineupStatus", () => {
  const before = [
    { playerId: 1, slot: "QB" as const },
    { playerId: 2, slot: "FLEX" as const },
    { playerId: 3, slot: "BN" as const },
    { playerId: 4, slot: "IR" as const },
  ];
  const after = before.map((p) => (p.playerId === 2 ? { ...p, slot: "BN" as const } : p.playerId === 3 ? { ...p, slot: "FLEX" as const } : p));

  it("reads who starts on ESPN", () => {
    expect(espnStartersOf(before)).toEqual([1, 2]);
  });

  it("names the AI's starters ESPN doesn't start yet, and whether ESPN changed since writing", () => {
    expect(aiLineupStatus(lineup(espnStartersOf(before)), before)).toEqual({ changedSince: false, missing: [{ key: "FLEX", playerId: 3 }] });
    expect(aiLineupStatus(lineup(espnStartersOf(before)), after)).toEqual({ changedSince: true, missing: [] });
  });

  it("can't tell whether ESPN changed for a lineup written before that was recorded", () => {
    expect(aiLineupStatus(lineup(), after).changedSince).toBeNull();
  });
});
