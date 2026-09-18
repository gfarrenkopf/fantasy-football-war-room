import { describe, expect, it } from "vitest";
import {
  buildRoster,
  byeClash,
  byeWeekList,
  conflicts,
  positionCounts,
  rosterNeeds,
  slotLabel,
  starterByeCounts,
  type PlayerLookup,
} from "./roster";
import type { DraftPick, Player, Position, RosterSlot } from "./types";

// Players copied from prototype/war_room.html (name, pos, team, bye, ECR).
const P = (name: string, pos: Position, team: string, bye: number, consensusRank: number): Player => ({
  id: name.toLowerCase().replace(/[^a-z]+/g, "-"),
  name,
  pos,
  team,
  bye,
  consensusRank,
  adp: consensusRank,
  posRank: 1,
});

const gibbs = P("Jahmyr Gibbs", "RB", "DET", 6, 1);
const chaseBrown = P("Chase Brown", "RB", "CIN", 6, 13);
const swift = P("D'Andre Swift", "RB", "CHI", 10, 47);
const warren = P("Jaylen Warren", "RB", "PIT", 9, 70);
const mason = P("Jordan Mason", "RB", "MIN", 6, 105);
const collins = P("Nico Collins", "WR", "HOU", 8, 22);
const ajBrown = P("A.J. Brown", "WR", "NE", 11, 19);
const watson = P("Christian Watson", "WR", "GB", 11, 55);
const higgins = P("Tee Higgins", "WR", "CIN", 6, 35);
const kraft = P("Tucker Kraft", "TE", "GB", 11, 80);
const caleb = P("Caleb Williams", "QB", "CHI", 10, 76);
const allen = P("Josh Allen", "QB", "BUF", 7, 30);
const bates = P("Jake Bates", "K", "DET", 6, 165);
const lionsDst = P("Lions D/ST", "DST", "DET", 6, 183);
const texansDst = P("Texans D/ST", "DST", "HOU", 8, 145);

const ALL = [gibbs, chaseBrown, swift, warren, mason, collins, ajBrown, watson, higgins, kraft, caleb, allen, bates, lionsDst, texansDst];
const lookup: PlayerLookup = (id) => ALL.find((p) => p.id === id);

const slot = (key: RosterSlot["key"], ...eligible: Position[]): RosterSlot => ({ key, eligible });
// The prototype's 16-slot roster: QB, RB, RB, WR, WR, TE, FLEX, DST, K, 7 BN.
const STANDARD: RosterSlot[] = [
  slot("QB", "QB"),
  slot("RB", "RB"),
  slot("RB", "RB"),
  slot("WR", "WR"),
  slot("WR", "WR"),
  slot("TE", "TE"),
  slot("FLEX", "RB", "WR", "TE"),
  slot("DST", "DST"),
  slot("K", "K"),
  ...Array.from({ length: 7 }, () => slot("BN")),
];

/** My picks in order, with an other-team pick between each so pick numbers are realistic. */
const mine = (...players: Player[]): DraftPick[] =>
  players.flatMap((p) => [
    { playerId: p.id, mine: true },
    { playerId: "someone-else", mine: false },
  ]);

const roster = (...players: Player[]) => buildRoster(mine(...players), lookup, STANDARD).slots;
const at = (slots: ReturnType<typeof roster>, i: number) => slots[i].player?.name ?? null;

describe("buildRoster", () => {
  it("fills dedicated slots in pick order and records pick numbers", () => {
    const slots = roster(gibbs, collins, caleb);
    expect(at(slots, 0)).toBe("Caleb Williams");
    expect(at(slots, 1)).toBe("Jahmyr Gibbs");
    expect(at(slots, 3)).toBe("Nico Collins");
    expect(slots[1].player?.pickNo).toBe(1);
    expect(slots[0].player?.pickNo).toBe(5);
  });

  it("puts the best-ranked leftover RB/WR/TE in FLEX, the rest on the bench", () => {
    // RBs: Gibbs, Chase Brown fill RB slots; Swift (47) and Warren (70) are leftovers.
    // WRs: Collins, Brown fill WR slots; Watson (55) is a leftover. Swift (47) is best → FLEX.
    const slots = roster(gibbs, chaseBrown, collins, ajBrown, warren, watson, swift);
    expect(at(slots, 6)).toBe("D'Andre Swift");
    expect(slots.slice(9).map((s) => s.player?.name).filter(Boolean)).toEqual(["Jaylen Warren", "Christian Watson"]);
  });

  it("ignores other teams' picks and unknown ids", () => {
    const picks: DraftPick[] = [
      { playerId: gibbs.id, mine: false },
      { playerId: "not-a-player", mine: true },
      { playerId: collins.id, mine: true },
    ];
    const { slots } = buildRoster(picks, lookup, STANDARD);
    expect(slots.filter((s) => s.player).map((s) => s.player!.name)).toEqual(["Nico Collins"]);
    expect(slots[3].player?.pickNo).toBe(3);
  });

  it("returns overflow when there are more players than roster spots", () => {
    const tiny = [slot("RB", "RB"), slot("BN")];
    const { slots, overflow } = buildRoster(mine(gibbs, chaseBrown, swift), lookup, tiny);
    expect(slots.map((s) => s.player?.name)).toEqual(["Jahmyr Gibbs", "Chase Brown"]);
    expect(overflow.map((p) => p.name)).toEqual(["D'Andre Swift"]);
  });

  it("fills FLEX before SUPERFLEX so a spare QB lands in SUPERFLEX", () => {
    const sf = [slot("QB", "QB"), slot("RB", "RB"), slot("SUPERFLEX", "QB", "RB", "WR", "TE"), slot("FLEX", "RB", "WR", "TE"), slot("BN")];
    const { slots } = buildRoster(mine(allen, gibbs, caleb, swift), lookup, sf);
    expect(slots.map((s) => s.player?.name ?? null)).toEqual(["Josh Allen", "Jahmyr Gibbs", "Caleb Williams", "D'Andre Swift", null]);
  });
});

describe("slotLabel", () => {
  const slots = roster(gibbs, chaseBrown, collins, ajBrown, caleb, swift, warren, lionsDst);

  it("numbers slots the league has more than one of", () => {
    expect(slotLabel(slots, chaseBrown.id)).toBe("RB2");
    expect(slotLabel(slots, collins.id)).toBe("WR1");
  });

  it("names single, flex, D/ST and bench slots plainly", () => {
    expect(slotLabel(slots, caleb.id)).toBe("QB");
    expect(slotLabel(slots, swift.id)).toBe("FLEX");
    expect(slotLabel(slots, lionsDst.id)).toBe("D/ST");
    expect(slotLabel(slots, warren.id)).toBe("Bench");
  });

  it("is null for a player not on the roster", () => {
    expect(slotLabel(slots, higgins.id)).toBeNull();
  });
});

describe("conflicts (count-based bye conflicts)", () => {
  it("flags a WR + FLEX collision in week 11 as 2 out", () => {
    // Watson lands in FLEX; he and A.J. Brown share the NE/GB week 11 bye.
    const slots = roster(gibbs, chaseBrown, collins, ajBrown, watson);
    expect(at(slots, 6)).toBe("Christian Watson");
    const bad = conflicts(slots);
    expect(bad.get(ajBrown.id)).toEqual({ n: 2, who: ["Christian Watson (WR)"] });
    expect(bad.get(watson.id)).toEqual({ n: 2, who: ["A.J. Brown (WR)"] });
    expect(bad.has(collins.id)).toBe(false);
  });

  it("flags three starters out in week 6 as a red (3+) case", () => {
    const slots = roster(gibbs, chaseBrown, higgins);
    const bad = conflicts(slots);
    expect([...bad.values()].map((c) => c.n)).toEqual([3, 3, 3]);
    expect(bad.get(higgins.id)?.who).toEqual(["Jahmyr Gibbs (RB)", "Chase Brown (RB)"]);
  });

  it("ignores K and D/ST sharing a starter's bye", () => {
    expect(conflicts(roster(gibbs, bates, lionsDst)).size).toBe(0);
  });

  it("ignores bench players", () => {
    // Three week-11 WRs: two start (WR + FLEX), and with Collins in a WR slot the third goes to the bench.
    const slots = roster(collins, ajBrown, watson, higgins, gibbs, chaseBrown, swift, kraft);
    // WR slots: Collins, Brown. FLEX: best of Watson 55 / Higgins 35 / Swift 47 → Higgins. Watson → bench.
    expect(at(slots, 6)).toBe("Tee Higgins");
    const bad = conflicts(slots);
    expect(bad.get(ajBrown.id)).toEqual({ n: 2, who: ["Tucker Kraft (TE)"] });
    expect(bad.has(watson.id)).toBe(false);
  });
});

describe("byeClash", () => {
  const picks = mine(gibbs, chaseBrown);

  it("predicts the conflict a candidate would create", () => {
    expect(byeClash(higgins, picks, lookup, STANDARD)).toEqual({ n: 3, who: ["Jahmyr Gibbs (RB)", "Chase Brown (RB)"] });
  });

  it("is null when there is no clash, and always for K/D/ST", () => {
    expect(byeClash(collins, picks, lookup, STANDARD)).toBeNull();
    expect(byeClash(bates, picks, lookup, STANDARD)).toBeNull();
  });

  it("is null for a candidate who would only reach the bench", () => {
    const full = mine(gibbs, swift, collins, ajBrown, kraft, warren);
    // RB, RB, WR, WR, TE, FLEX (Warren, 70) are full. Jordan Mason (week 6, like Gibbs) ranks
    // below Warren, so he would sit on the bench and create no starter conflict.
    expect(byeClash(mason, full, lookup, STANDARD)).toBeNull();
    // Chase Brown (13) outranks Warren and would take FLEX, so he does clash with Gibbs.
    expect(byeClash(chaseBrown, full, lookup, STANDARD)?.n).toBe(2);
  });
});

describe("bye summary helpers", () => {
  it("counts starters out per week and lists the league's bye weeks", () => {
    const slots = roster(gibbs, chaseBrown, collins, texansDst);
    expect(starterByeCounts(slots, [6, 8, 11])).toEqual([
      { week: 6, n: 2 },
      { week: 8, n: 1 },
      { week: 11, n: 0 },
    ]);
    expect(byeWeekList({ DET: 6, CIN: 6, HOU: 8, NE: 11 })).toEqual([6, 8, 11]);
  });

  it("positionCounts counts every position", () => {
    expect(positionCounts([gibbs, swift, caleb])).toEqual({ QB: 1, RB: 2, WR: 0, TE: 0, K: 0, DST: 0 });
  });
});

describe("rosterNeeds", () => {
  const byKey = (needs: ReturnType<typeof rosterNeeds>, key: string) => needs.groups.find((g) => g.key === key)!;

  it("at the start, needs every skill position and treats FLEX/K/DST as soft", () => {
    const needs = rosterNeeds(roster(), 1, 16);
    expect(needs.need).toEqual(["QB", "RB", "WR", "TE"]);
    expect(byKey(needs, "FLEX").soft).toBe(true);
    expect(byKey(needs, "K").soft).toBe(true);
    expect(needs.urgentAny).toBe(false);
    expect(needs.bench).toEqual({ filled: 0, total: 7 });
  });

  it("escalates by round: RB/WR at 6, QB/TE at 8, FLEX at 9, K/DST at 13", () => {
    const empty = roster();
    expect(byKey(rosterNeeds(empty, 5, 16), "RB").urgent).toBe(false);
    expect(byKey(rosterNeeds(empty, 6, 16), "RB").urgent).toBe(true);
    expect(byKey(rosterNeeds(empty, 7, 16), "QB").urgent).toBe(false);
    expect(byKey(rosterNeeds(empty, 8, 16), "TE").urgent).toBe(true);
    expect(byKey(rosterNeeds(empty, 12, 16), "DST").urgent).toBe(false);
    expect(byKey(rosterNeeds(empty, 13, 16), "DST").urgent).toBe(true);
  });

  it("keeps FLEX soft while a dedicated RB/WR/TE slot is open, then makes it urgent at round 9", () => {
    const noTe = roster(caleb, gibbs, chaseBrown, collins, ajBrown);
    expect(byKey(rosterNeeds(noTe, 10, 16), "FLEX")).toMatchObject({ soft: true, urgent: false });
    const withTe = roster(caleb, gibbs, chaseBrown, collins, ajBrown, kraft);
    expect(byKey(rosterNeeds(withTe, 8, 16), "FLEX")).toMatchObject({ open: true, urgent: false });
    expect(byKey(rosterNeeds(withTe, 9, 16), "FLEX")).toMatchObject({ open: true, urgent: true });
  });

  it("scales thresholds for shorter drafts", () => {
    // 12 rounds: RB urgent at round(6 * 12/16) = 5.
    expect(byKey(rosterNeeds(roster(), 5, 12), "RB").urgent).toBe(true);
  });

  it("counts bench players per position and reports a full starting lineup", () => {
    const slots = roster(caleb, gibbs, chaseBrown, collins, ajBrown, kraft, swift, texansDst, bates, warren);
    const needs = rosterNeeds(slots, 10, 16);
    expect(needs.allStartersFilled).toBe(true);
    expect(needs.need).toEqual([]);
    expect(byKey(needs, "RB").benchCount).toBe(1);
    expect(byKey(needs, "RB").filled).toEqual([true, true]);
    expect(needs.bench).toEqual({ filled: 1, total: 7 });
  });
});
