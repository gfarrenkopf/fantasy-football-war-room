import { describe, expect, it } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { weekSwing } from "./swing";
import type { SeasonView, ViewPlayer } from "./view";

const total = (roster: ViewPlayer[]) => Math.round(roster.filter((p) => p.slot !== "BN" && p.slot !== "IR").reduce((s, p) => s + (p.actual ?? 0), 0) * 10) / 10;

function week(mine: ViewPlayer[], theirs: ViewPlayer[]): SeasonView {
  const view = seasonView(mine, theirs);
  return { ...view, matchup: { me: { teamId: 1, points: total(mine), projected: 0, winProbability: null }, them: { teamId: 2, points: total(theirs), projected: 0, winProbability: null } } };
}

// ESPN had the user up 10 (60 to 50). Hubbard went off, the opponent's QB flopped, the rest was noise.
const mine = [
  at("QB", player("Kyler Murray", "QB", 20, { playerId: 1, actual: 21 })),
  at("RB", player("Chuba Hubbard", "RB", 15, { playerId: 2, actual: 27 })),
  at("WR", player("Davante Adams", "WR", 25, { playerId: 3, actual: 18.4 })),
  player("Nico Collins", "WR", 12, { playerId: 4, actual: 30.8 }),
];
const theirs = [at("QB", player("Saquon Q", "QB", 30, { playerId: 11, actual: 14.5 })), at("RB", player("Their RB", "RB", 20, { playerId: 12, actual: 21 }))];

describe("weekSwing", () => {
  const swing = weekSwing(week(mine, theirs), null)!;

  it("starts from ESPN's margin before kickoff and lands on the final", () => {
    expect(swing).toMatchObject({ projected: 10, final: 30.9 });
    const last = swing.rest ?? swing.swings.at(-1)!;
    expect(last.after).toBe(30.9);
  });

  it("names the biggest swings first, the user's pushing the margin up and the opponent's pulling it back", () => {
    expect(swing.swings.map((s) => [s.name, s.side, s.delta, s.before, s.after])).toEqual([
      ["Saquon Q", "them", 15.5, 10, 25.5],
      ["Chuba Hubbard", "me", 12, 25.5, 37.5],
      ["Davante Adams", "me", -6.6, 37.5, 30.9],
    ]);
    // Murray's +1 and their RB's +1 are too small to name, and cancel out.
    expect(swing.rest).toBeNull();
    const noisy = weekSwing(week([...mine.slice(0, 3), at("TE", player("Tight End", "TE", 8, { playerId: 5, actual: 9.5 }))], theirs), null)!;
    expect(noisy.rest).toEqual({ delta: 1.5, before: 38.9, after: 40.4 });
  });

  it("totals each side's starters against their projections", () => {
    expect(swing).toMatchObject({ mine: 6.4, theirs: -14.5 });
  });

  it("finds the points left on the bench, and whether they'd have flipped a loss", () => {
    expect(swing.hindsight).toEqual({ total: 97.2, gain: 30.8, wouldHaveWon: false, best: { name: "Nico Collins", points: 30.8 } });
    const close = [at("QB", player("Their QB", "QB", 30, { playerId: 21, actual: 70 }))];
    expect(weekSwing(week(mine, close), null)!.hindsight).toMatchObject({ wouldHaveWon: true });
  });

  it("names the starters who were never going to score", () => {
    expect(swing.empty).toEqual([]);
    const out = at("TE", player("Out Guy", "TE", 0, { playerId: 6, actual: 0, injuryStatus: "OUT" }));
    expect(weekSwing(week([...mine, out], theirs), null)!.empty).toEqual(["Out Guy"]);
  });

  it("leaves the bench out when the lineup set was already the best", () => {
    expect(weekSwing(week(mine.slice(0, 3), theirs), null)!.hindsight).toBeNull();
  });

  it("is null without a matchup", () => {
    expect(weekSwing(seasonView(mine), null)).toBeNull();
  });
});
