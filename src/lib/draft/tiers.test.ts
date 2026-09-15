import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { dataset, DEFAULT_LEAGUE, LEAGUE_PRESETS } from "@/lib/data";
import { computeTiers, LATE_TIER, naturalBreaks } from "./tiers";
import type { Player } from "./types";

/** The prototype's hand-authored tiers (RAW column 6), keyed by "name|pos". */
function prototypeTiers(): Map<string, number> {
  const html = readFileSync(new URL("../../../prototype/war_room.html", import.meta.url), "utf8");
  const from = html.indexOf("[", html.indexOf("const RAW"));
  const rows = runInNewContext(`(${html.slice(from, html.indexOf("\n];", from) + 2)})`) as [string, string, ...unknown[]][];
  return new Map(rows.map((r) => [`${r[0]}|${r[1]}`, r[5] as number]));
}

describe("naturalBreaks", () => {
  it("splits at the obvious gaps", () => {
    expect(naturalBreaks([1, 2, 3, 10, 11, 12, 30, 31], 3)).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
  });

  it("handles fewer values than classes and empty input", () => {
    expect(naturalBreaks([5, 9], 4)).toEqual([0, 1]);
    expect(naturalBreaks([], 4)).toEqual([]);
  });

  it("always returns contiguous, non-decreasing classes using every class", () => {
    const values = Array.from({ length: 40 }, (_, i) => Math.sqrt(i * 3 + (i % 7)));
    const classes = naturalBreaks(values, 4);
    expect(classes.every((c, i) => i === 0 || c >= classes[i - 1])).toBe(true);
    expect(new Set(classes)).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("computeTiers on the sample dataset (12-team PPR)", () => {
  const tiers = computeTiers(dataset.players, DEFAULT_LEAGUE);
  const proto = prototypeTiers();
  const skill = dataset.players.filter((p) => !["K", "DST"].includes(p.pos));
  const tierOf = (p: Player) => tiers.get(p.id)!;
  const protoOf = (p: Player) => proto.get(`${p.name}|${p.pos}`)!;

  it("assigns every player a tier", () => {
    expect(tiers.size).toBe(dataset.players.length);
  });

  it("puts every K and D/ST in the late tier", () => {
    dataset.players.filter((p) => p.pos === "K" || p.pos === "DST").forEach((p) => expect(tierOf(p)).toBe(LATE_TIER));
  });

  it("never ranks a player in a better tier than someone ranked above him at his position", () => {
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const list = skill.filter((p) => p.pos === pos).sort((a, b) => a.consensusRank - b.consensusRank);
      list.forEach((p, i) => i > 0 && expect(tierOf(p)).toBeGreaterThanOrEqual(tierOf(list[i - 1])));
    }
  });

  it("agrees with the prototype's hand-tuned tiers: ≥80% exact, 100% within one tier", () => {
    const exact = skill.filter((p) => tierOf(p) === protoOf(p)).length;
    const within = skill.filter((p) => Math.abs(tierOf(p) - protoOf(p)) <= 1).length;
    expect(exact / skill.length).toBeGreaterThanOrEqual(0.8);
    expect(within).toBe(skill.length);
  });

  it("keeps each position's tier 1 within one player of the prototype's", () => {
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const mine = skill.filter((p) => p.pos === pos && tierOf(p) === 1).map((p) => p.name);
      const theirs = skill.filter((p) => p.pos === pos && protoOf(p) === 1).map((p) => p.name);
      expect(Math.abs(mine.length - theirs.length)).toBeLessThanOrEqual(1);
      // Tier 1 is always the top of the position, so it's a prefix of the prototype's or vice versa.
      const [short, long] = mine.length <= theirs.length ? [mine, theirs] : [theirs, mine];
      expect(long.slice(0, short.length).sort()).toEqual(short.slice().sort());
    }
  });
});

describe("computeTiers across leagues", () => {
  it("tiers more players in bigger leagues", () => {
    const tiered = (teams: number) => {
      const league = LEAGUE_PRESETS.find((p) => p.league.teams === teams)!.league;
      return [...computeTiers(dataset.players, league).values()].filter((t) => t < LATE_TIER).length;
    };
    expect(tiered(10)).toBeLessThan(tiered(12));
    expect(tiered(12)).toBeLessThan(tiered(14));
  });

  it("uses projected points when every tiered player has them", () => {
    const mk = (id: string, consensusRank: number, projPoints: number): Player => ({
      id, name: id, pos: "WR", team: "X", bye: 5, consensusRank, adp: consensusRank, posRank: 0, projPoints,
    });
    // Ranks are evenly spaced, but points have clear gaps: {300, 298} {250, 249} {200} {150, 149}.
    const players = [mk("a", 1, 300), mk("b", 2, 298), mk("c", 3, 250), mk("d", 4, 249), mk("e", 5, 200), mk("f", 6, 150), mk("g", 7, 149)];
    const tiers = computeTiers(players, DEFAULT_LEAGUE);
    expect(players.map((p) => tiers.get(p.id))).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });
});
