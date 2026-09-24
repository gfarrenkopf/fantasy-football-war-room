import { describe, expect, it } from "vitest";
import projections from "./__fixtures__/espn-projections-2026.json";
import { parseProjections, projectionFilter, projectionStatIds } from "./projections";

describe("parseProjections", () => {
  const players = parseProjections(projections, 2026);

  it("reads every player with a weekly projection for each remaining week", () => {
    expect(players).toHaveLength(16);
    const gibbs = players.find((p) => p.name === "Jahmyr Gibbs")!;
    expect(gibbs).toMatchObject({ id: 4429795, pos: "RB", team: "DET" });
    expect([...gibbs.weeks.keys()].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it("reads a D/ST by its team", () => {
    expect(players.find((p) => p.pos === "DST")).toMatchObject({ name: "Broncos D/ST", team: "DEN" });
  });

  it("ignores actuals, season rows and other seasons' rows", () => {
    const raw = {
      players: [
        {
          player: {
            id: 1, fullName: "X", defaultPositionId: 2, proTeamId: 8, injuryStatus: "OUT",
            stats: [
              { statSourceId: 0, statSplitTypeId: 1, seasonId: 2026, scoringPeriodId: 3, stats: { "53": 9 } },
              { statSourceId: 1, statSplitTypeId: 0, seasonId: 2026, scoringPeriodId: 0, stats: { "53": 90 } },
              { statSourceId: 1, statSplitTypeId: 1, seasonId: 2025, scoringPeriodId: 4, stats: { "53": 7 } },
              { statSourceId: 1, statSplitTypeId: 1, seasonId: 2026, scoringPeriodId: 5, stats: { "53": 5, bad: "x" } },
            ],
          },
        },
      ],
    };
    const [p] = parseProjections(raw, 2026);
    expect(p.injuryStatus).toBe("OUT");
    expect([...p.weeks]).toEqual([[5, { "53": 5 }]]);
  });

  it("skips players it can't read, and positions War Room doesn't play", () => {
    const raw = { players: [{ player: { id: 2, fullName: "Coach", defaultPositionId: 14 } }, { nope: true }] };
    expect(parseProjections(raw, 2026)).toEqual([]);
    expect(() => parseProjections([], 2026)).toThrow("ESPN projections");
  });
});

describe("projectionFilter", () => {
  it("asks for one weekly projection per week in the range", () => {
    expect(projectionStatIds(2026, 16, 17)).toEqual(["11202616", "11202617"]);
    const filter = JSON.parse(projectionFilter(2026, [1, 2], 16, 17));
    expect(filter.players.filterIds.value).toEqual([1, 2]);
    expect(filter.players.filterStatsForTopScoringPeriodIds.additionalValue).toEqual(["11202616", "11202617"]);
  });
});
