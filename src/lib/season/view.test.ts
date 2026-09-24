import { describe, expect, it } from "vitest";
import league from "./__fixtures__/espn-league-2026.json";
import projections from "./__fixtures__/espn-projections-2026.json";
import { parseSeasonLeague } from "./espnLeague";
import { parseProjections } from "./projections";
import { buildSeasonView } from "./view";

const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const season = parsed.league;
const byId = new Map(parseProjections(projections, 2026).map((p) => [p.id, p]));

describe("buildSeasonView", () => {
  const view = buildSeasonView(season, 1, byId);

  it("scores every rostered player week by week, through the league's last week", () => {
    const gibbs = view.teams[0].roster.find((p) => p.name === "Jahmyr Gibbs")!;
    expect(Object.keys(gibbs.weekly).map(Number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(gibbs.weekly[6]).toBe(0);
    expect(gibbs.points).toBe(gibbs.weekly[3]);
    expect(gibbs.ros).toBeCloseTo(Object.values(gibbs.weekly).reduce((a, b) => a + b, 0), 1);
    expect(gibbs.projected).toBe(true);
  });

  it("shows a player ESPN didn't project as 0, and says so", () => {
    const other = view.teams[1].roster[0];
    expect(other).toMatchObject({ projected: false, points: 0, ros: 0 });
  });

  it("recommends the user's own lineup", () => {
    expect(view.lineup.starters.every((s) => s.playerId !== null)).toBe(true);
    const mine = new Set(view.teams[0].roster.map((p) => p.playerId));
    expect(view.lineup.starters.every((s) => mine.has(s.playerId!))).toBe(true);
  });
});
