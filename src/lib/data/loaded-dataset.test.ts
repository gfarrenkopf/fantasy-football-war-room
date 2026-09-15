/**
 * Checks whatever dataset src/lib/data/index.ts loads, with no assumptions about the sample data.
 * Self-hosters run this on their own file with `npm run check-data`.
 */
import { describe, expect, it } from "vitest";
import { validateLeague } from "@/lib/draft/league";
import { totalPicks } from "@/lib/draft/snake";
import { POSITIONS } from "@/lib/draft/types";
import { dataset, LEAGUE_PRESETS } from "./index";

describe(`loaded dataset: ${dataset.label}`, () => {
  it("passes validation (fields, types, unique ids)", () => {
    // `dataset` is validated on import; getting here means the shape is valid.
    expect(dataset.players.length).toBeGreaterThan(0);
  });

  it("has a bye week for every player's team, matching the player's bye", () => {
    const wrong = dataset.players.filter((p) => dataset.byeWeeks[p.team] !== p.bye).map((p) => `${p.name} (${p.team})`);
    expect(wrong, "players whose bye doesn't match byeWeeks[team]").toEqual([]);
  });

  it("numbers position ranks 1, 2, 3, … within each position", () => {
    for (const pos of POSITIONS) {
      const ranks = dataset.players
        .filter((p) => p.pos === pos)
        .map((p) => p.posRank)
        .sort((a, b) => a - b);
      expect(ranks, `${pos} posRank values`).toEqual(ranks.map((_, i) => i + 1));
    }
  });

  it("has enough players, kickers and D/STs for at least one league preset", () => {
    const fits = LEAGUE_PRESETS.filter((p) => validateLeague({ ...p.league, scoring: dataset.scoring[0] }, dataset).length === 0);
    const smallest = LEAGUE_PRESETS[0].league;
    expect(fits.length, `needs at least ${totalPicks(smallest) + 10} players for a ${smallest.teams}-team league`).toBeGreaterThan(0);
    const late = (pos: string) => dataset.players.filter((p) => p.pos === pos).length;
    expect(late("K"), "kickers (one per team)").toBeGreaterThanOrEqual(smallest.teams);
    expect(late("DST"), "D/STs (one per team)").toBeGreaterThanOrEqual(smallest.teams);
  });
});
