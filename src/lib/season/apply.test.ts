import { describe, expect, it } from "vitest";
import { alignSeats, checkMoves, chooseSeat, espnRefusal, groupMoves, landedMoves, madeMoves, movesToStaged, rosterChanges, seatsFromRoster, snapshotOf, starterSeats, toEspnItems, type ApplyEntry } from "./apply";
import { ESPN_SLOT_ID } from "./espnLeague";
import type { LineupSlot, LineupSlotCount } from "./types";

const STARTERS: LineupSlotCount[] = [
  { key: "QB", count: 1 },
  { key: "RB", count: 2 },
  { key: "WR", count: 1 },
  { key: "FLEX", count: 1 },
];

let id = 0;
const entry = (name: string, pos: ApplyEntry["pos"], slot: LineupSlot, locked = false): ApplyEntry => ({ playerId: ++id, name, pos, slot, espnSlotId: ESPN_SLOT_ID[slot], locked });

function team() {
  const qb = entry("Qb", "QB", "QB");
  const rb1 = entry("Rb One", "RB", "RB");
  const rb2 = entry("Rb Two", "RB", "RB");
  const wr = entry("Wr", "WR", "WR");
  const flex = entry("Flex Wr", "WR", "FLEX");
  const benchRb = entry("Bench Rb", "RB", "BN");
  const benchWr = entry("Bench Wr", "WR", "BN");
  const ir = entry("Hurt", "TE", "IR");
  return { qb, rb1, rb2, wr, flex, benchRb, benchWr, ir, roster: [qb, rb1, rb2, wr, flex, benchRb, benchWr, ir] };
}

describe("movesToStaged", () => {
  it("moves only the players whose slot changes, benches unstaged starters, and leaves IR alone", () => {
    const t = team();
    const seats = starterSeats(STARTERS); // QB RB RB WR FLEX
    // Swap the bench RB in for Rb One, and the bench WR into FLEX. Rb Two moves seats but not slots.
    const staged = [t.qb.playerId, t.rb2.playerId, t.benchRb.playerId, t.wr.playerId, t.benchWr.playerId];
    expect(movesToStaged(t.roster, seats, staged)).toEqual([
      { playerId: t.rb1.playerId, from: "RB", to: "BN" },
      { playerId: t.flex.playerId, from: "FLEX", to: "BN" },
      { playerId: t.benchRb.playerId, from: "BN", to: "RB" },
      { playerId: t.benchWr.playerId, from: "BN", to: "FLEX" },
    ]);
  });

  it("benches a starter whose seat is left empty", () => {
    const t = team();
    const staged = [t.qb.playerId, t.rb1.playerId, t.rb2.playerId, t.wr.playerId, null];
    expect(movesToStaged(t.roster, starterSeats(STARTERS), staged)).toEqual([{ playerId: t.flex.playerId, from: "FLEX", to: "BN" }]);
  });
});

describe("groupMoves", () => {
  it("ties each player to the one whose seat they take, and leaves unrelated moves apart", () => {
    const t = team();
    const seats = starterSeats(STARTERS); // QB RB RB WR FLEX
    const before = seatsFromRoster(t.roster, seats);
    const staged = [t.qb.playerId, t.rb2.playerId, t.benchRb.playerId, t.wr.playerId, t.benchWr.playerId];
    const moves = movesToStaged(t.roster, seats, staged);
    const [rbSwap, flexSwap] = groupMoves(moves, before, staged);
    expect(rbSwap.map((m) => m.playerId)).toEqual([t.rb1.playerId, t.benchRb.playerId]);
    expect(flexSwap.map((m) => m.playerId)).toEqual([t.flex.playerId, t.benchWr.playerId]);
  });

  it("keeps a chain through FLEX in one group", () => {
    const t = team();
    const seats = starterSeats(STARTERS);
    const before = seatsFromRoster(t.roster, seats);
    // The WR slides to FLEX, the FLEX goes to the bench, and the bench WR takes the WR seat.
    const staged = [t.qb.playerId, t.rb1.playerId, t.rb2.playerId, t.benchWr.playerId, t.wr.playerId];
    const moves = movesToStaged(t.roster, seats, staged);
    expect(groupMoves(moves, before, staged)).toEqual([moves]);
  });

  it("stands a player alone when their seat is left empty", () => {
    const t = team();
    const seats = starterSeats(STARTERS);
    const before = seatsFromRoster(t.roster, seats);
    const staged = [t.qb.playerId, t.rb1.playerId, t.rb2.playerId, null, t.flex.playerId];
    expect(groupMoves(movesToStaged(t.roster, seats, staged), before, staged)).toEqual([[{ playerId: t.wr.playerId, from: "WR", to: "BN" }]]);
  });
});

describe("alignSeats", () => {
  it("keeps a player in his ESPN seat, so only seats that really change differ", () => {
    const t = team();
    const seats = starterSeats(STARTERS); // QB RB RB WR FLEX
    const before = seatsFromRoster(t.roster, seats);
    // War Room's order puts Rb Two first and the bench RB second: Rb One's seat is the one that changes.
    const after = [t.qb.playerId, t.rb2.playerId, t.benchRb.playerId, t.wr.playerId, t.flex.playerId];
    expect(alignSeats(seats, before, after)).toEqual([t.qb.playerId, t.benchRb.playerId, t.rb2.playerId, t.wr.playerId, t.flex.playerId]);
  });

  it("leaves a seat empty where the staged lineup has nobody", () => {
    const t = team();
    const seats = starterSeats(STARTERS);
    const before = seatsFromRoster(t.roster, seats);
    expect(alignSeats(seats, before, [t.qb.playerId, null, t.rb2.playerId, t.wr.playerId, t.flex.playerId])).toEqual([
      t.qb.playerId,
      null,
      t.rb2.playerId,
      t.wr.playerId,
      t.flex.playerId,
    ]);
  });
});

describe("chooseSeat", () => {
  const seats = starterSeats(STARTERS); // QB RB RB WR FLEX

  it("puts a bench player in a seat, sending its holder to the bench", () => {
    const t = team();
    const staged = seatsFromRoster(t.roster, seats);
    expect(chooseSeat(staged, seats, t.roster, 1, t.benchRb.playerId)).toEqual([t.qb.playerId, t.benchRb.playerId, t.rb2.playerId, t.wr.playerId, t.flex.playerId]);
  });

  it("swaps two starters when each can play the other's seat", () => {
    const t = team();
    const staged = seatsFromRoster(t.roster, seats);
    // Rb One into FLEX: the FLEX WR can't play RB, so his old seat is left empty rather than misfilled.
    expect(chooseSeat(staged, seats, t.roster, 4, t.rb1.playerId)).toEqual([t.qb.playerId, null, t.rb2.playerId, t.wr.playerId, t.rb1.playerId]);
    // The WR into FLEX and the FLEX WR into WR: both fit, so they trade.
    expect(chooseSeat(staged, seats, t.roster, 4, t.wr.playerId)).toEqual([t.qb.playerId, t.rb1.playerId, t.rb2.playerId, t.flex.playerId, t.wr.playerId]);
  });

  it("empties a seat", () => {
    const t = team();
    const staged = seatsFromRoster(t.roster, seats);
    expect(chooseSeat(staged, seats, t.roster, 0, null)[0]).toBeNull();
  });
});

describe("seatsFromRoster", () => {
  it("seats ESPN's starters in order, leaves empty slots null, and stages no moves", () => {
    const t = team();
    const seats = starterSeats(STARTERS);
    const roster = t.roster.filter((p) => p !== t.flex);
    const staged = seatsFromRoster(roster, seats);
    expect(staged).toEqual([t.qb.playerId, t.rb1.playerId, t.rb2.playerId, t.wr.playerId, null]);
    expect(movesToStaged(roster, seats, staged)).toEqual([]);
  });
});

describe("checkMoves", () => {
  it("passes a legal set of swaps", () => {
    const t = team();
    const moves = [
      { playerId: t.rb1.playerId, from: "RB" as const, to: "BN" as const },
      { playerId: t.benchRb.playerId, from: "BN" as const, to: "RB" as const },
      { playerId: t.flex.playerId, from: "FLEX" as const, to: "BN" as const },
      { playerId: t.benchWr.playerId, from: "BN" as const, to: "FLEX" as const },
    ];
    expect(checkMoves(t.roster, moves, STARTERS, 3)).toEqual([]);
  });

  it("refuses a move involving a locked player", () => {
    const t = team();
    const locked = { ...t.rb1, locked: true };
    const roster = t.roster.map((p) => (p.playerId === locked.playerId ? locked : p));
    const moves = [
      { playerId: locked.playerId, from: "RB" as const, to: "BN" as const },
      { playerId: t.benchRb.playerId, from: "BN" as const, to: "RB" as const },
    ];
    expect(checkMoves(roster, moves, STARTERS, 3)).toEqual(["Rb One's game has started, so ESPN won't move them this week."]);
  });

  it("refuses ineligible slots, overfull slots, stale positions, repeats, IR and strangers", () => {
    const t = team();
    expect(checkMoves(t.roster, [{ playerId: t.benchRb.playerId, from: "BN", to: "QB" }], STARTERS, 3)).toContain("Bench Rb can't play QB.");
    expect(checkMoves(t.roster, [{ playerId: t.benchRb.playerId, from: "BN", to: "RB" }], STARTERS, 3)).toEqual(["That's 3 players at RB; the league starts 2."]);
    expect(checkMoves(t.roster, [{ playerId: t.benchRb.playerId, from: "RB", to: "BN" }], STARTERS, 3)).toEqual(["Bench Rb is at the bench on ESPN, not RB."]);
    expect(checkMoves(t.roster, [{ playerId: 999_999, from: "BN", to: "RB" }], STARTERS, 3)).toEqual(["Player 999999 isn't on your team."]);
    const twice = [
      { playerId: t.rb1.playerId, from: "RB" as const, to: "BN" as const },
      { playerId: t.rb1.playerId, from: "RB" as const, to: "FLEX" as const },
    ];
    expect(checkMoves(t.roster, twice, STARTERS, 3)).toContain("Rb One is moved twice.");
    expect(checkMoves(t.roster, [], STARTERS, 3)).toEqual(["There's nothing to change."]);
  });

  it("refuses a slot the league doesn't have, and a bench that would overflow", () => {
    const t = team();
    expect(checkMoves(t.roster, [{ playerId: t.benchWr.playerId, from: "BN", to: "SUPERFLEX" }], STARTERS, 3)).toEqual(["This league has no OP slot."]);
    expect(checkMoves(t.roster, [{ playerId: t.flex.playerId, from: "FLEX", to: "BN" }], STARTERS, 2)).toEqual(["That leaves 3 players on a 2-player bench."]);
    expect(checkMoves(t.roster, [{ playerId: t.flex.playerId, from: "FLEX", to: "BN" }], STARTERS, 3)).toEqual([]);
  });
});

describe("IR (13.2)", () => {
  it("activates onto a bench with room, and refuses a full one", () => {
    const t = team();
    expect(checkMoves(t.roster, [{ playerId: t.ir.playerId, from: "IR", to: "BN" }], STARTERS, 3, 1)).toEqual([]);
    expect(checkMoves(t.roster, [{ playerId: t.ir.playerId, from: "IR", to: "BN" }], STARTERS, 2, 1)).toEqual(["That leaves 3 players on a 2-player bench."]);
  });

  it("puts only players out or on injured reserve on IR, up to the league's IR spots", () => {
    const t = team();
    const out = { ...t.benchRb, injuryStatus: "OUT" };
    const roster = t.roster.map((p) => (p.playerId === out.playerId ? out : p));
    const toIr = [{ playerId: out.playerId, from: "BN" as const, to: "IR" as const }];
    expect(checkMoves(roster, toIr, STARTERS, 3, 2)).toEqual([]);
    expect(checkMoves(roster, toIr, STARTERS, 3, 1)).toEqual(["That's 2 players on IR; the league has 1 IR spot."]);
    expect(checkMoves(t.roster, [{ playerId: t.benchWr.playerId, from: "BN", to: "IR" }], STARTERS, 3, 2)).toEqual([
      "Bench Wr isn't hurt enough for IR: ESPN only takes players who are out or on injured reserve.",
    ]);
  });

  it("stages IR moves when told who should be on IR", () => {
    const t = team();
    const seats = starterSeats(STARTERS);
    const staged = seatsFromRoster(t.roster, seats);
    // Without `ir`, IR is left alone; with it, the IR player comes off to the bench and a bench player goes on.
    expect(movesToStaged(t.roster, seats, staged)).toEqual([]);
    expect(movesToStaged(t.roster, seats, staged, [t.benchRb.playerId])).toEqual([
      { playerId: t.benchRb.playerId, from: "BN", to: "IR" },
      { playerId: t.ir.playerId, from: "IR", to: "BN" },
    ]);
  });
});

describe("toEspnItems", () => {
  it("takes fromLineupSlotId from ESPN's roster and maps the target slot to ESPN's id", () => {
    const t = team();
    expect(toEspnItems(t.roster, [{ playerId: t.benchWr.playerId, from: "BN", to: "FLEX" }])).toEqual([
      { playerId: t.benchWr.playerId, type: "LINEUP", fromLineupSlotId: 20, toLineupSlotId: 23 },
    ]);
  });
});

describe("rosterChanges", () => {
  it("is empty when nothing changed", () => {
    const t = team();
    expect(rosterChanges(snapshotOf(t.roster), t.roster)).toEqual([]);
  });

  it("names players moved, added and dropped since staging", () => {
    const t = team();
    const staged = snapshotOf(t.roster);
    const newcomer = entry("Waiver Add", "WR", "BN");
    const now = [...t.roster.filter((p) => p !== t.benchRb), newcomer].map((p) => (p === t.rb1 ? { ...p, slot: "BN" as const } : p));
    expect(rosterChanges(staged, now)).toEqual(["Rb One moved from RB to the bench.", "Waiver Add joined your roster.", "A player left your roster."]);
  });
});

describe("landedMoves", () => {
  it("marks each move by where ESPN has the player afterwards", () => {
    const t = team();
    const moves = [
      { playerId: t.rb1.playerId, from: "RB" as const, to: "BN" as const },
      { playerId: t.benchRb.playerId, from: "BN" as const, to: "RB" as const },
    ];
    const after = t.roster.map((p) => (p === t.rb1 ? { ...p, slot: "BN" as const } : p));
    expect(landedMoves(moves, after).map((m) => m.landed)).toEqual([true, false]);
  });
});

describe("madeMoves (APE-256)", () => {
  it("keeps Draft Room's suggested moves that landed, with their gain", () => {
    const moves = [
      { playerId: 1, from: "BN" as const, to: "RB" as const, landed: true },
      { playerId: 2, from: "RB" as const, to: "BN" as const, landed: true },
      { playerId: 3, from: "BN" as const, to: "WR" as const, landed: false },
      { playerId: 4, from: "BN" as const, to: "FLEX" as const, landed: true },
    ];
    const suggested = [
      { playerId: 1, to: "RB" as const, gain: 4.2 },
      { playerId: 3, to: "WR" as const, gain: 2 },
      // The page claimed a slot the player didn't go to.
      { playerId: 4, to: "TE" as const, gain: 9 },
    ];
    expect(madeMoves(moves, suggested)).toEqual([{ playerId: 1, from: "BN", to: "RB", gain: 4.2 }]);
  });
});

describe("espnRefusal", () => {
  it("words known refusals and falls back to ESPN's message", () => {
    expect(espnRefusal("TRAN_ROSTER_SLOT_LIMIT_EXCEEDED", "Too many players in the RB slot (maximum 2)")).toBe(
      "ESPN says a slot would be over its limit: Too many players in the RB slot (maximum 2)",
    );
    expect(espnRefusal("TRAN_LINEUP_LOCKED", "Lineup transaction could not be completed, Drake London is locked")).toContain("game has started");
    expect(espnRefusal("TRAN_ROSTER_INELIGIBLE_IR_NOT_INJURED", "X is not eligible for the IL/IR slot, player is not injured.")).toContain("only puts injured players on IR");
    expect(espnRefusal("TRAN_ROSTER_LIMIT_EXCEEDED_ONE", "Too many players on roster (maximum 16).")).toContain("drop a player");
    expect(espnRefusal("TRAN_SOMETHING_NEW", "Player is locked.")).toBe("ESPN refused the change: Player is locked.");
    expect(espnRefusal("TRAN_SOMETHING_NEW", "")).toBe("ESPN refused the change (TRAN_SOMETHING_NEW).");
  });
});
