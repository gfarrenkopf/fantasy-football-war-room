import { describe, expect, it } from "vitest";
import {
  formatRoundPick,
  isMyPick,
  myPickNumbers,
  myTurns,
  nextMyPick,
  pickInRound,
  roundOf,
  slotOf,
  totalPicks,
} from "./snake";
import type { RosterSlot } from "./types";

const roster16: RosterSlot[] = Array.from({ length: 16 }, () => ({ key: "BN", eligible: [] }));
const league = (teams: number, mySlot: number) => ({ teams, mySlot, roster: roster16 });

describe("round and pick-in-round", () => {
  it("matches the prototype for a 12-team league", () => {
    expect(roundOf(1, 12)).toBe(1);
    expect(roundOf(12, 12)).toBe(1);
    expect(roundOf(13, 12)).toBe(2);
    expect(pickInRound(13, 12)).toBe(1);
    expect(pickInRound(24, 12)).toBe(12);
    expect(formatRoundPick(1, 12)).toBe("1.01");
    expect(formatRoundPick(25, 12)).toBe("3.01");
    expect(formatRoundPick(192, 12)).toBe("16.12");
  });
});

describe("snake order", () => {
  for (const teams of [10, 12, 14]) {
    it(`${teams} teams: odd rounds ascend, even rounds descend`, () => {
      for (let round = 1; round <= 16; round++) {
        const slots = Array.from({ length: teams }, (_, i) => slotOf((round - 1) * teams + i + 1, teams));
        const ascending = Array.from({ length: teams }, (_, i) => i + 1);
        expect(slots).toEqual(round % 2 === 1 ? ascending : ascending.reverse());
      }
    });

    it(`${teams} teams: every slot gets exactly one pick per round`, () => {
      for (let mySlot = 1; mySlot <= teams; mySlot++) {
        const picks = myPickNumbers(league(teams, mySlot));
        expect(picks).toHaveLength(16);
        expect(picks.map((n) => roundOf(n, teams))).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
        picks.forEach((n) => expect(slotOf(n, teams)).toBe(mySlot));
      }
    });

    it(`${teams} teams: each overall pick belongs to exactly one slot`, () => {
      const total = teams * 16;
      for (let n = 1; n <= total; n++) {
        const owners = Array.from({ length: teams }, (_, i) => i + 1).filter((s) => isMyPick(n, league(teams, s)));
        expect(owners).toEqual([slotOf(n, teams)]);
      }
    });
  }
});

describe("the prototype's 12-team slot 1.01 league", () => {
  const l = league(12, 1);

  it("picks at 1, 24/25, 48/49, ..., 192", () => {
    expect(myTurns(l)).toEqual([[1], [24, 25], [48, 49], [72, 73], [96, 97], [120, 121], [144, 145], [168, 169], [192]]);
  });

  it("nextMyPick finds the next turn and the sentinel after the last pick", () => {
    expect(nextMyPick(1, l)).toBe(1);
    expect(nextMyPick(2, l)).toBe(24);
    expect(nextMyPick(25, l)).toBe(25);
    expect(nextMyPick(26, l)).toBe(48);
    expect(nextMyPick(193, l)).toBe(totalPicks(l) + 1);
  });
});

describe("edge slots", () => {
  it("the last slot has back-to-back picks at the end of odd rounds", () => {
    expect(myTurns(league(10, 10)).slice(0, 3)).toEqual([[10, 11], [30, 31], [50, 51]]);
  });

  it("a middle slot never has back-to-back picks", () => {
    expect(myTurns(league(14, 7)).every((t) => t.length === 1)).toBe(true);
    expect(myPickNumbers(league(14, 7)).slice(0, 4)).toEqual([7, 22, 35, 50]);
  });

  it("isMyPick is false outside the draft", () => {
    const l = league(12, 1);
    expect(isMyPick(0, l)).toBe(false);
    expect(isMyPick(193, l)).toBe(false);
  });

  it("myPickNumbers respects the starting pick", () => {
    expect(myPickNumbers(league(12, 1), 50)).toEqual([72, 73, 96, 97, 120, 121, 144, 145, 168, 169, 192]);
  });
});
