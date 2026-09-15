import { describe, expect, it } from "vitest";
import { totalPicks } from "@/lib/draft/snake";
import sample from "./sample-2026.json";
import { dataset, DatasetError, DEFAULT_LEAGUE, indexPlayers, LEAGUE_PRESETS, standardRoster, validateDataset } from "./index";

describe("sample dataset", () => {
  it("is valid and clearly labeled as sample data", () => {
    expect(dataset.label).toMatch(/sample/i);
    expect(dataset.scoring).toEqual(["ppr"]);
    expect(dataset.adpSource).toBe("ESPN");
  });

  it("matches the prototype's players", () => {
    const byId = indexPlayers(dataset);
    expect(dataset.players).toHaveLength(225);
    expect(byId.get("jahmyr-gibbs-rb-det")).toMatchObject({ consensusRank: 1, adp: 1, posRank: 1, bye: 6 });
    expect(byId.get("chris-godwin-wr-tb")).toMatchObject({ consensusRank: 82, adp: 128, posRank: 34, bye: 10 });
    expect(byId.get("texans-d-st-dst-hou")).toMatchObject({ pos: "DST", bye: 8 });
  });

  it("gives every player his team's bye week and a unique position rank", () => {
    for (const p of dataset.players) expect(p.bye).toBe(dataset.byeWeeks[p.team]);
    for (const pos of ["QB", "RB", "WR", "TE", "K", "DST"]) {
      const ranks = dataset.players.filter((p) => p.pos === pos).map((p) => p.posRank).sort((a, b) => a - b);
      expect(ranks).toEqual(ranks.map((_, i) => i + 1));
    }
  });

  it("has enough players to fill every preset's draft", () => {
    for (const { league } of LEAGUE_PRESETS) {
      // Leave spare skill players so the last picks aren't forced onto extra kickers and D/STs.
      expect(dataset.players.length).toBeGreaterThanOrEqual(totalPicks(league) + 10);
      expect(dataset.players.filter((p) => p.pos === "K").length).toBeGreaterThanOrEqual(league.teams);
      expect(dataset.players.filter((p) => p.pos === "DST").length).toBeGreaterThanOrEqual(league.teams);
    }
  });
});

describe("validateDataset", () => {
  const clone = () => structuredClone(sample) as Record<string, unknown> & { players: Record<string, unknown>[] };

  it("rejects malformed data with a useful message", () => {
    expect(() => validateDataset(null)).toThrow(DatasetError);
    expect(() => validateDataset({ ...clone(), scoring: ["ppr", "superflex"] })).toThrow(/scoring/);
    const badPos = clone();
    badPos.players[0].pos = "LB";
    expect(() => validateDataset(badPos)).toThrow(/players\[0\]\.pos/);
    const badRank = clone();
    badRank.players[3].adp = "12";
    expect(() => validateDataset(badRank)).toThrow(/players\[3\]\.adp/);
    const dup = clone();
    dup.players[1].id = dup.players[0].id;
    expect(() => validateDataset(dup)).toThrow(/duplicate player id/);
  });

  it("accepts optional projPoints", () => {
    const withProj = clone();
    withProj.players[0].projPoints = 312.4;
    expect(() => validateDataset(withProj)).not.toThrow();
  });
});

describe("league presets", () => {
  it("offer 10, 12 and 14 team PPR leagues on the standard roster (14 teams with a 6-man bench)", () => {
    expect(LEAGUE_PRESETS.map((p) => p.league.teams)).toEqual([10, 12, 14]);
    expect(LEAGUE_PRESETS.map((p) => p.league.roster.length)).toEqual([16, 16, 15]);
    for (const { league } of LEAGUE_PRESETS) {
      expect(league.scoring).toBe("ppr");
      expect(league.mySlot).toBe(1);
    }
    expect(DEFAULT_LEAGUE.teams).toBe(12);
  });

  it("standardRoster returns independent copies", () => {
    const a = standardRoster();
    a[0].eligible.push("RB");
    expect(standardRoster()[0].eligible).toEqual(["QB"]);
    expect(standardRoster(5)).toHaveLength(14);
  });
});
