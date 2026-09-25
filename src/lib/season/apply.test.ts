import { describe, expect, it } from "vitest";
import { checkMoves, espnRefusal, landedMoves, movesToStaged, rosterChanges, snapshotOf, starterSeats, toEspnItems, type ApplyEntry } from "./apply";
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
    expect(checkMoves(t.roster, [{ playerId: t.ir.playerId, from: "IR", to: "BN" }], STARTERS, 3)).toEqual(["War Room doesn't move players on or off IR. Do that on ESPN."]);
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

describe("espnRefusal", () => {
  it("words known refusals and falls back to ESPN's message", () => {
    expect(espnRefusal("TRAN_ROSTER_SLOT_LIMIT_EXCEEDED", "Too many players in the RB slot (maximum 2)")).toBe(
      "ESPN says a slot would be over its limit: Too many players in the RB slot (maximum 2)",
    );
    expect(espnRefusal("TRAN_LINEUP_LOCKED", "Lineup transaction could not be completed, Drake London is locked")).toContain("game has started");
    expect(espnRefusal("TRAN_SOMETHING_NEW", "Player is locked.")).toBe("ESPN refused the change: Player is locked.");
    expect(espnRefusal("TRAN_SOMETHING_NEW", "")).toBe("ESPN refused the change (TRAN_SOMETHING_NEW).");
  });
});
