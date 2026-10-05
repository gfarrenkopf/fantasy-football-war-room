import { describe, expect, it } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { weekRecap } from "./recap";
import type { SeasonView } from "./view";

const withMatchup = (view: SeasonView, me: number, them: number): SeasonView => ({
  ...view,
  matchup: { me: { teamId: 1, points: me, projected: 0, winProbability: null }, them: { teamId: 2, points: them, projected: 0, winProbability: null } },
});

describe("weekRecap", () => {
  const qb = at("QB", player("Kyler Murray", "QB", 19.2, { playerId: 1, actual: 11.5 }));
  const rb = at("RB", player("Chuba Hubbard", "RB", 16.6, { playerId: 2, actual: 25.9 }));
  const wr = at("WR", player("Davante Adams", "WR", 15.6, { playerId: 3, actual: 7.2 }));
  const bench = player("Tee Higgins", "WR", 13.7, { playerId: 4, actual: 26.7 });
  const view = withMatchup(seasonView([qb, rb, wr, bench]), 151.2, 97.3);

  it("tells the result, the margin and the starters in slot order, bench left out", () => {
    const recap = weekRecap(view, null)!;
    expect(recap).toMatchObject({ week: 5, result: "win", me: 151.2, them: 97.3, margin: 53.9, opponent: "Theirs" });
    expect(recap.starters.map((p) => [p.slot, p.name, p.points])).toEqual([
      ["QB", "Kyler Murray", 11.5],
      ["RB", "Chuba Hubbard", 25.9],
      ["WR", "Davante Adams", 7.2],
    ]);
  });

  it("makes the starter who most beat his projection the star, judged against ESPN's recorded call", () => {
    expect(weekRecap(view, null)!.star).toMatchObject({ player: { name: "Chuba Hubbard" }, beat: true });
    const called = { me: null, them: null, season: null, players: [{ playerId: 2, projected: 30, actual: 25.9 }] };
    expect(weekRecap(view, called)!.star).toMatchObject({ player: { name: "Chuba Hubbard" }, beat: false });
    expect(weekRecap(view, called)!.starters[1].projected).toBe(30);
  });

  it("falls back to the top scorer when nobody beat his projection", () => {
    const flat = withMatchup(seasonView([at("QB", player("A", "QB", 20, { actual: 12 })), at("RB", player("B", "RB", 15, { actual: 14 }))]), 26, 30);
    expect(weekRecap(flat, null)).toMatchObject({ result: "loss", star: { player: { name: "B" }, beat: false } });
  });

  it("is null without a matchup", () => {
    expect(weekRecap(seasonView([qb]), null)).toBeNull();
  });
});
