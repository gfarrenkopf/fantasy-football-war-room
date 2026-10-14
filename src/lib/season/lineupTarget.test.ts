import { describe, expect, it } from "vitest";
import league from "./__fixtures__/espn-league-2026.json";
import projections from "./__fixtures__/espn-projections-2026.json";
import { seatsFromRoster, starterSeats } from "./apply";
import { parseSeasonLeague } from "./espnLeague";
import { lineupTarget } from "./lineupTarget";
import { parseProjections } from "./projections";
import { buildSeasonView, type SeasonView } from "./view";

const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const view = buildSeasonView(parsed.league, 1, new Map(parseProjections(projections, 2026).map((p) => [p.id, p])));
const roster = view.teams.find((t) => t.id === view.myTeamId)!.roster;
const seats = starterSeats(view.starters); // QB RB RB WR WR TE FLEX DST K
const onEspn = seatsFromRoster(roster, seats);
const id = (name: string) => roster.find((p) => p.name === name)!.playerId;

/** ESPN's lineup with the given seats changed. */
const lineup = (changes: Record<number, number | null>) => onEspn.map((p, i) => (i in changes ? changes[i] : p));
const withLocked = (name: string): SeasonView => ({
  ...view,
  teams: view.teams.map((t) => (t.id === view.myTeamId ? { ...t, roster: t.roster.map((p) => (p.name === name ? { ...p, locked: true } : p)) } : t)),
});

describe("lineupTarget (APE-381)", () => {
  it("turns ESPN's own lineup into no changes", () => {
    expect(lineupTarget(view, onEspn)).toMatchObject({ changes: [], moves: [], suggested: [], problems: [] });
  });

  it("turns a target lineup into the moves that set it, one change per swap, in plain words", () => {
    // Javonte Williams in for James Cook at RB; Terry McLaurin in for Drake London at WR.
    const target = lineupTarget(view, lineup({ 2: id("Javonte Williams"), 4: id("Terry McLaurin") }))!;
    expect(target.changes.map((c) => c.text).sort()).toEqual(["Start Javonte Williams at RB, bench James Cook III", "Start Terry McLaurin at WR, bench Drake London"]);
    expect(target.changes.every((c) => c.picked)).toBe(true);
    expect(target.moves).toEqual(
      expect.arrayContaining([
        { playerId: id("James Cook III"), from: "RB", to: "BN" },
        { playerId: id("Javonte Williams"), from: "BN", to: "RB" },
        { playerId: id("Drake London"), from: "WR", to: "BN" },
        { playerId: id("Terry McLaurin"), from: "BN", to: "WR" },
      ]),
    );
    expect(target.moves).toHaveLength(4);
    expect(target.problems).toEqual([]);
  });

  it("doesn't count two players of a slot trading seats as a change", () => {
    expect(lineupTarget(view, lineup({ 1: onEspn[2], 2: onEspn[1] }))!.changes).toEqual([]);
  });

  it("makes only the picked changes", () => {
    const all = lineupTarget(view, lineup({ 2: id("Javonte Williams"), 4: id("Terry McLaurin") }))!;
    const wr = all.changes.find((c) => c.text.includes("McLaurin"))!;
    const target = lineupTarget(view, lineup({ 2: id("Javonte Williams"), 4: id("Terry McLaurin") }), [wr.id])!;
    expect(target.changes.map((c) => [c.id, c.picked])).toEqual(all.changes.map((c) => [c.id, c.id === wr.id]));
    expect(target.moves).toEqual(wr.moves);
  });

  it("claims only the moves War Room recommended, with what each gains", () => {
    // War Room starts Javonte Williams over James Cook; the user also benches Drake London for McLaurin.
    const plan = { ...view, lineup: { ...view.lineup, starters: view.lineup.starters.map((f, i) => (i === 2 ? { ...f, playerId: id("Javonte Williams") } : f)) } };
    const points = (name: string) => roster.find((p) => p.name === name)!.points;
    const target = lineupTarget(plan, lineup({ 2: id("Javonte Williams"), 4: id("Terry McLaurin") }))!;
    expect(target.suggested).toEqual([{ playerId: id("Javonte Williams"), to: "RB", gain: Math.round((points("Javonte Williams") - points("James Cook III")) * 100) / 100 }]);
  });

  it("says why a locked player can't move", () => {
    const target = lineupTarget(withLocked("James Cook III"), lineup({ 2: id("Javonte Williams") }))!;
    expect(target.changes).toHaveLength(1);
    expect(target.problems).toEqual(["James Cook III's game has started, so ESPN won't move them this week."]);
  });

  it("says why a player can't take a seat", () => {
    const target = lineupTarget(view, lineup({ 0: id("Javonte Williams") }))!;
    expect(target.problems).toContain("Javonte Williams can't play QB.");
  });

  it("refuses players who aren't on the team, or are named twice", () => {
    expect(lineupTarget(view, lineup({ 2: 999 }))!.problems).toEqual(["Player 999 isn't on your team."]);
    expect(lineupTarget(view, lineup({ 2: onEspn[1] }))!.problems).toEqual(["Jahmyr Gibbs is in two slots."]);
  });

  it("is null when the lineup doesn't fit the league's seats or a change id isn't this lineup's", () => {
    expect(lineupTarget(view, onEspn.slice(1))).toBeNull();
    expect(lineupTarget(view, lineup({ 2: id("Javonte Williams") }), ["1:QB"])).toBeNull();
  });
});
