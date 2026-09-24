import { describe, expect, it } from "vitest";
import league from "./__fixtures__/espn-league-2026.json";
import scored from "./__fixtures__/espn-league-scored-2026.json";
import projections from "./__fixtures__/espn-projections-2026.json";
import { parseProjections } from "./projections";
import { parseScoringItems, restOfSeason, scoreStats, weeklyPoints } from "./scoring";
import type { ScoringItem } from "./types";

const players = parseProjections(projections, 2026);
const items = parseScoringItems(league.settings.scoringSettings.scoringItems);
const week = scored.scoringPeriodId;
const named = (name: string) => players.find((p) => p.name === name)!;

describe("scoreStats against ESPN's own league scoring", () => {
  it("reproduces the league-scored projection for every rostered player, D/ST and K included", () => {
    const expected = scored.points as Record<string, number>;
    expect(players.length).toBe(Object.keys(expected).length);
    for (const p of players) {
      expect(scoreStats(p.weeks.get(week)!, items, p.pos)).toBeCloseTo(expected[String(p.id)], 4);
    }
  });

  it("applies a league's own scoring: half PPR takes half a point per reception off", () => {
    const half = items.map((i): ScoringItem => (i.statId === 53 ? { ...i, points: 0.5 } : i));
    const p = named("Amon-Ra St. Brown");
    const stats = p.weeks.get(week)!;
    expect(scoreStats(stats, half, p.pos)).toBeCloseTo(scoreStats(stats, items, p.pos) - 0.5 * stats["53"], 6);
  });

  it("uses the slot override for the player's position only", () => {
    const item: ScoringItem[] = [{ statId: 1, points: 1, pointsOverrides: { "16": 5 } }];
    expect(scoreStats({ "1": 2 }, item, "DST")).toBe(10);
    expect(scoreStats({ "1": 2 }, item, "RB")).toBe(2);
  });
});

describe("restOfSeason", () => {
  it("sums weekly points over the range, with a bye (or missing week) as zero", () => {
    const gibbs = weeklyPoints(named("Jahmyr Gibbs"), items);
    expect(gibbs.get(6)).toBe(0); // DET's bye
    const byHand = [...gibbs].filter(([w]) => w >= week && w <= 17).reduce((a, [, v]) => a + v, 0);
    expect(restOfSeason(gibbs, week, 17)).toBeCloseTo(byHand, 6);
    expect(restOfSeason(new Map([[5, 10]]), 3, 6)).toBe(10);
  });
});

describe("parseScoringItems", () => {
  it("keeps well-formed items and drops the rest", () => {
    expect(parseScoringItems([{ statId: 53, points: 1, pointsOverrides: {} }, { statId: "x" }, null])).toEqual([{ statId: 53, points: 1 }]);
    expect(parseScoringItems("nope")).toEqual([]);
  });
});
