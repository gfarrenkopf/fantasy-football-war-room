import { describe, expect, it } from "vitest";
import league from "./__fixtures__/espn-league-2026.json";
import projections from "./__fixtures__/espn-projections-2026.json";
import { maxWeightAssignment } from "./assign";
import { parseSeasonLeague } from "./espnLeague";
import { optimalLineup, type LineupCandidate } from "./lineup";
import { parseProjections } from "./projections";
import { weeklyPoints } from "./scoring";
import type { LineupSlotCount } from "./types";

const STANDARD: LineupSlotCount[] = [
  { key: "QB", count: 1 },
  { key: "RB", count: 2 },
  { key: "WR", count: 2 },
  { key: "TE", count: 1 },
  { key: "FLEX", count: 1 },
  { key: "DST", count: 1 },
  { key: "K", count: 1 },
];

let id = 0;
const player = (pos: LineupCandidate["pos"], points: number, extra: Partial<LineupCandidate> = {}): LineupCandidate => ({
  playerId: ++id,
  pos,
  slot: "BN",
  locked: false,
  injuryStatus: "ACTIVE",
  points,
  ...extra,
});

describe("maxWeightAssignment", () => {
  it("finds the best assignment where taking each row's favourite would not be", () => {
    // Greedy gives row 0 column 0 (10) and leaves row 1 with 1: 11. Best is 9 + 8 = 17.
    expect(maxWeightAssignment([[10, 9], [8, 1]])).toEqual([1, 0]);
    expect(maxWeightAssignment([[-Infinity, 1], [1, -Infinity]])).toEqual([1, 0]);
    expect(maxWeightAssignment([])).toEqual([]);
  });
});

describe("optimalLineup", () => {
  it("starts the best players, using FLEX for the best leftover RB/WR/TE", () => {
    const qb = player("QB", 20);
    const rbs = [player("RB", 18), player("RB", 15), player("RB", 14)];
    const wrs = [player("WR", 16), player("WR", 12), player("WR", 13.5)];
    const te = player("TE", 9);
    const dst = player("DST", -1);
    const k = player("K", 8);
    const plan = optimalLineup([qb, ...rbs, ...wrs, te, dst, k], STANDARD);
    const at = (key: string) => plan.starters.filter((s) => s.key === key).map((s) => s.playerId);
    expect(at("RB").sort()).toEqual([rbs[0].playerId, rbs[1].playerId].sort());
    expect(at("FLEX")).toEqual([rbs[2].playerId]);
    expect(at("WR").sort()).toEqual([wrs[0].playerId, wrs[2].playerId].sort());
    // A D/ST projected negative still starts over an empty slot.
    expect(at("DST")).toEqual([dst.playerId]);
    expect(plan.bench).toEqual([wrs[1].playerId]);
    expect(plan.total).toBeCloseTo(20 + 18 + 15 + 14 + 16 + 13.5 + 9 - 1 + 8);
  });

  it("benches players on a bye or ruled out, and leaves locked players where they are", () => {
    const qb = player("QB", 20, { slot: "QB" });
    const byeRb = player("RB", 0, { slot: "RB" });
    const outRb = player("RB", 17, { slot: "RB", injuryStatus: "OUT" });
    const benchRbs = [player("RB", 11), player("RB", 10)];
    // Thursday's WR has played: locked on the bench even though they'd be worth starting now.
    const lockedWr = player("WR", 25, { locked: true });
    const lockedFlex = player("WR", 3, { slot: "FLEX", locked: true });
    const wrs = [player("WR", 12, { slot: "WR" }), player("WR", 9, { slot: "WR" })];
    const plan = optimalLineup([qb, byeRb, outRb, ...benchRbs, lockedWr, lockedFlex, ...wrs], [...STANDARD.slice(0, 3), { key: "FLEX", count: 1 }]);
    const rb = plan.starters.filter((s) => s.key === "RB").map((s) => s.playerId).sort();
    expect(rb).toEqual(benchRbs.map((p) => p.playerId).sort());
    expect(plan.starters.find((s) => s.key === "FLEX")).toMatchObject({ playerId: lockedFlex.playerId, locked: true });
    expect(plan.bench).toContain(lockedWr.playerId);
    expect(plan.moves).toEqual(
      expect.arrayContaining([
        { playerId: byeRb.playerId, from: "RB", to: "BN" },
        { playerId: outRb.playerId, from: "RB", to: "BN" },
        { playerId: benchRbs[0].playerId, from: "BN", to: "RB" },
        { playerId: benchRbs[1].playerId, from: "BN", to: "RB" },
      ]),
    );
    expect(plan.moves).toHaveLength(4);
  });

  it("keeps players in their current slots on a tie, so it doesn't invent swaps", () => {
    const a = player("RB", 10, { slot: "FLEX" });
    const b = player("RB", 10, { slot: "RB" });
    const c = player("RB", 10, { slot: "RB" });
    expect(optimalLineup([a, b, c], [{ key: "RB", count: 2 }, { key: "FLEX", count: 1 }]).moves).toEqual([]);
  });

  it("leaves a slot empty rather than start a player ruled out, and leaves IR alone", () => {
    const out = player("TE", 12, { injuryStatus: "OUT" });
    const ir = player("TE", 14, { slot: "IR", injuryStatus: "INJURY_RESERVE" });
    const plan = optimalLineup([out, ir], [{ key: "TE", count: 1 }]);
    expect(plan.starters).toEqual([{ key: "TE", playerId: null, points: 0, locked: false }]);
    expect(plan.moves).toEqual([]);
  });

  it("sets a real ESPN roster from its real projections", () => {
    const parsed = parseSeasonLeague(league, "110222051");
    if (!parsed.ok) throw new Error(parsed.error);
    const { league: season } = parsed;
    const byId = new Map(parseProjections(projections, 2026).map((p) => [p.id, weeklyPoints(p, season.scoringItems)]));
    const candidates = season.teams[0].roster.map((e) => ({ ...e, points: byId.get(e.playerId)?.get(season.currentWeek) ?? 0 }));
    const plan = optimalLineup(candidates, season.starters);
    expect(plan.starters.every((s) => s.playerId !== null)).toBe(true);
    expect(plan.total).toBeGreaterThanOrEqual(plan.currentTotal);
    // Every recommended starter in a dedicated slot projects at least as well as every benched player at that position.
    for (const s of plan.starters.filter((f) => f.key !== "FLEX")) {
      const starter = candidates.find((c) => c.playerId === s.playerId)!;
      for (const b of candidates.filter((c) => plan.bench.includes(c.playerId) && c.pos === starter.pos)) {
        expect(starter.points).toBeGreaterThanOrEqual(b.points);
      }
    }
  });
});
