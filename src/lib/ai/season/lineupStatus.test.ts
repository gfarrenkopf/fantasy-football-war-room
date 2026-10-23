import { describe, expect, it } from "vitest";
import type { AiLineup } from "./lineup";
import { aiLineupOutdated, aiLineupStatus, espnStartersOf } from "./lineupStatus";

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

describe("aiLineupOutdated", () => {
  const game = { kickoff: "2026-10-18T17:00:00Z", opponent: "GB", home: true, state: "pre", clock: null, score: null } as never;
  const player = (playerId: number, points: number, extra: object = {}) => ({ playerId, injuryStatus: "ACTIVE" as const, projected: true, points, team: "DET", game, ...extra });
  // Written with 1 at QB and 3 at FLEX over the engine's 2.
  const roster = [player(1, 20), player(2, 12), player(3, 11), player(4, 9)];
  const plan = (total: number) => ({ starters: [], total });

  it("holds while the engine's lineup then is still within a close call of its pick now", () => {
    expect(aiLineupOutdated(lineup(), plan(32), roster)).toBe(false);
    expect(aiLineupOutdated(lineup(), plan(34), roster)).toBe(false);
  });

  it("is outdated when the engine's pick now beats its pick then by more than a close call", () => {
    expect(aiLineupOutdated(lineup(), plan(34.5), roster)).toBe(true);
  });

  it("is outdated when one of the AI's starters is ruled out, likely out, or gone", () => {
    expect(aiLineupOutdated(lineup(), plan(32), roster.map((p) => (p.playerId === 3 ? { ...p, injuryStatus: "OUT" as const } : p)))).toBe(true);
    expect(aiLineupOutdated(lineup(), plan(32), roster.map((p) => (p.playerId === 3 ? { ...p, points: 0 } : p)))).toBe(true);
    expect(aiLineupOutdated(lineup(), plan(32), roster.filter((p) => p.playerId !== 1))).toBe(true);
  });

  it("holds while the engine still starts him, having nobody better", () => {
    const out = roster.map((p) => (p.playerId === 3 ? { ...p, injuryStatus: "OUT" as const } : p));
    expect(aiLineupOutdated(lineup(), { starters: [{ key: "FLEX", playerId: 3, points: 11, locked: false }], total: 32 }, out)).toBe(false);
  });
});
