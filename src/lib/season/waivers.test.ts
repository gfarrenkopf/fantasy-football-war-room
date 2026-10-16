import { describe, expect, it } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { nameMatches, rankPickups, rosteredMatching, valuePickup, waiverNote } from "./waivers";

// Starters: QB, RB×2, WR×2, TE, FLEX, D/ST, K (testView's STARTERS); bench of three.
const mine = [
  at("QB", player("My QB", "QB", 18)),
  at("RB", player("My RB1", "RB", 14)),
  at("RB", player("My RB2", "RB", 6)),
  at("WR", player("My WR1", "WR", 13)),
  at("WR", player("My WR2", "WR", 11)),
  at("TE", player("My TE", "TE", 7)),
  at("FLEX", player("My Flex", "WR", 8)),
  at("DST", player("My D", "DST", 6)),
  at("K", player("My K", "K", 7)),
  player("Bench RB", "RB", 5),
  player("Bench WR", "WR", 4),
  player("Bench TE", "TE", 2),
];
const view = seasonView(mine);
const free = (name: string, pos: Parameters<typeof player>[1], pts: number | number[]) => ({ ...player(name, pos, pts), status: "FREEAGENT" as const, waiverClears: null });

describe("rankPickups", () => {
  const rb = free("Waiver Back", "RB", 10);
  const te = free("Waiver End", "TE", 9);
  const bench = free("Depth Wideout", "WR", 3);
  const bye = free("Bye Back", "RB", [0, 12, 12]);
  const pickups = rankPickups(view, [bench, te, rb, bye]);

  it("ranks by what each pickup adds to the best lineup, and who he'd push off the roster", () => {
    expect(pickups.map((p) => p.player.name)).toEqual(["Waiver Back", "Bye Back", "Waiver End"]);
    expect(pickups[0]).toMatchObject({ delta: 12, perWeek: 4, drop: mine.find((p) => p.name === "Bench TE")!.playerId });
  });

  it("leaves out a player who'd only sit on the bench", () => {
    expect(pickups.map((p) => p.player.name)).not.toContain("Depth Wideout");
  });

  it("keeps only the top few", () => {
    expect(rankPickups(view, [rb, te, bye], 1)).toHaveLength(1);
  });
});

describe("valuePickup", () => {
  it("values a player who'd only sit on the bench at nothing, rather than leaving him out", () => {
    const bench = free("Depth Wideout", "WR", 3);
    expect(valuePickup(view, bench)).toMatchObject({ player: bench, delta: 0, perWeek: 0 });
  });

  it("matches what the ranked list says for the same player", () => {
    const rb = free("Waiver Back", "RB", 10);
    expect(valuePickup(view, rb)).toEqual(rankPickups(view, [rb])[0]);
  });

  it("has nothing to say without a team of the user's", () => {
    expect(valuePickup({ ...view, myTeamId: -99 }, free("Anyone", "RB", 10))).toBeNull();
  });
});

describe("nameMatches", () => {
  it("matches the start of any word, or of the whole name, ignoring case, as ESPN's filterName does", () => {
    expect(nameMatches("Tyler Bass", "bass")).toBe(true);
    expect(nameMatches("Tyler Bass", "Tyler B")).toBe(true);
    expect(nameMatches("Amon-Ra St. Brown", "st")).toBe(true);
    expect(nameMatches("Tyler Bass", "ass")).toBe(false);
    expect(nameMatches("Tyler Bass", "  ")).toBe(false);
  });
});

describe("rosteredMatching", () => {
  const theirs = { ...player("Bench Brown", "WR", 9), ownership: { owned: 99, started: 80 } };
  const league = { ...view, teams: [...view.teams.map((t) => (t.id === view.myTeamId ? t : { ...t, name: "Gridiron Gang", roster: [...t.roster, theirs] }))] };

  it("names whose team each match is on, the user's own marked, most-rostered first", () => {
    const found = rosteredMatching(league, "ben");
    expect(found[0]).toMatchObject({ player: { name: "Bench Brown" }, team: "Gridiron Gang", mine: false });
    expect(found.slice(1).map((r) => [r.player.name, r.mine])).toEqual([
      ["Bench RB", true],
      ["Bench WR", true],
      ["Bench TE", true],
    ]);
  });

  it("keeps to the position searched", () => {
    expect(rosteredMatching(league, "ben", "TE").map((r) => r.player.name)).toEqual(["Bench TE"]);
  });
});

describe("waiverNote", () => {
  it("says FAAB left in a league that bids, the waiver rank otherwise, and nothing when ESPN gave neither", () => {
    expect(waiverNote({ ...view, waiver: { rank: 3, budget: 100, left: 62 } })).toBe("$62 of $100 FAAB left");
    expect(waiverNote({ ...view, waiver: { rank: 3, budget: null, left: null } })).toBe("Waiver priority 3 of 2");
    expect(waiverNote(view)).toBeNull();
  });
});
