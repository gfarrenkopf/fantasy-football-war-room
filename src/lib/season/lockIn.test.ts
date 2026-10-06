import { describe, expect, it } from "vitest";
import { lockIn, lockInHeadline } from "./lockIn";

// Jefferson up from the bench into WR for Wilson; Kelce into TE for Kincaid.
const swapWr = [
  { playerId: 1, from: "BN" as const, to: "WR" as const, landed: true },
  { playerId: 2, from: "WR" as const, to: "BN" as const, landed: true },
];
const swapTe = [
  { playerId: 3, from: "BN" as const, to: "TE" as const, landed: true },
  { playerId: 4, from: "TE" as const, to: "BN" as const, landed: true },
];
const suggested = [
  { playerId: 1, to: "WR" as const, gain: 6.5 },
  { playerId: 3, to: "TE" as const, gain: 2 },
];

describe("lockIn", () => {
  it("banks every War Room move when the whole lineup lands", () => {
    const m = lockIn({
      landed: [...swapWr, ...swapTe],
      suggested,
      own: [],
      before: 100,
      after: 108.5,
      recommended: 108.5,
    });
    expect(m).toMatchObject({
      banked: 8.5,
      level: "swing",
      leftover: 0,
      confetti: true,
    });
    expect(m?.warRoom.map((x) => x.playerId)).toEqual([1, 3]);
  });

  it("keeps the user's own moves beside War Room's, whichever way they go", () => {
    const own = [{ playerId: 9, to: "FLEX" as const, delta: -1.2 }];
    const m = lockIn({
      landed: [...swapWr, ...swapTe, { playerId: 9, from: "BN", to: "FLEX", landed: true }],
      suggested,
      own,
      before: 100,
      after: 107.3,
      recommended: 108.5,
    });
    expect(m?.banked).toBe(8.5);
    expect(m?.own).toEqual(own);
    expect(m?.leftover).toBe(1.2);
  });

  it("banks part of the lineup and says what's left", () => {
    const m = lockIn({
      landed: swapTe,
      suggested,
      own: [],
      before: 100,
      after: 102,
      recommended: 108.5,
    });
    expect(m).toMatchObject({
      banked: 2,
      level: "gain",
      leftover: 6.5,
      confetti: false,
    });
  });

  it("holds the confetti when a big gain is left on the bench", () => {
    const m = lockIn({
      landed: swapWr,
      suggested: [{ playerId: 1, to: "WR", gain: 6 }],
      own: [],
      before: 100,
      after: 106,
      recommended: 112,
    });
    expect(m).toMatchObject({ level: "swing", leftover: 6, confetti: false });
  });

  it("doesn't play for the user's own moves alone", () => {
    expect(
      lockIn({
        landed: swapWr,
        suggested: [],
        own: [{ playerId: 1, to: "WR", delta: 3 }],
        before: 100,
        after: 103,
        recommended: 103,
      }),
    ).toBeNull();
  });

  it("doesn't play when a move didn't land", () => {
    expect(
      lockIn({
        landed: [swapWr[0], { ...swapWr[1], landed: false }],
        suggested,
        own: [],
        before: 100,
        after: 106.5,
        recommended: 108.5,
      }),
    ).toBeNull();
    expect(
      lockIn({
        landed: [],
        suggested,
        own: [],
        before: 100,
        after: 100,
        recommended: 108.5,
      }),
    ).toBeNull();
  });
});

describe("lockInHeadline", () => {
  it("grows with the ladder step", () => {
    expect(lockInHeadline("trim", 0.4)).toBe("Lineup locked. Every point counts");
    expect(lockInHeadline("gain", 3)).toBe("Lineup locked");
    expect(lockInHeadline("swing", 7)).toBe("Big swing, banked");
    expect(lockInHeadline("must", 12.34)).toBe("12.3 points off your bench");
  });
});
