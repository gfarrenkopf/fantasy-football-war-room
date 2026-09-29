import { describe, expect, it } from "vitest";
import { acquireItems, acquireLanded, checkAcquire, needsDrop, rosterLimit } from "./acquire";
import type { ApplyEntry } from "./apply";
import { ESPN_SLOT_ID } from "./espnLeague";
import type { LineupSlot, LineupSlotCount } from "./types";

const STARTERS: LineupSlotCount[] = [
  { key: "QB", count: 1 },
  { key: "RB", count: 1 },
];
const entry = (playerId: number, name: string, slot: LineupSlot, locked = false): ApplyEntry => ({ playerId, name, pos: "RB", slot, espnSlotId: ESPN_SLOT_ID[slot], locked });
// Limit 4: two starters and a two-player bench. IR doesn't count.
const FULL = [entry(1, "Qb", "QB"), entry(2, "Rb", "RB"), entry(3, "Bench One", "BN"), entry(4, "Bench Two", "BN"), entry(5, "Hurt", "IR")];
const LIMIT = rosterLimit(STARTERS, 2);
const THEM = [{ name: "Their Team", roster: [{ playerId: 50 }] }];

describe("rosterLimit / needsDrop", () => {
  it("counts starting slots plus the bench, and leaves IR out", () => {
    expect(LIMIT).toBe(4);
    expect(needsDrop(FULL, LIMIT)).toBe(true);
    expect(needsDrop(FULL.slice(1), LIMIT)).toBe(false);
  });
});

describe("checkAcquire", () => {
  it("passes an add with a drop on a full roster, and an add alone with room", () => {
    expect(checkAcquire(FULL, THEM, { add: 99, drop: 4 }, LIMIT)).toEqual([]);
    expect(checkAcquire(FULL.slice(1), THEM, { add: 99, drop: null }, LIMIT)).toEqual([]);
  });

  it("refuses a full roster with no drop, a locked or missing drop, and a player already taken", () => {
    expect(checkAcquire(FULL, THEM, { add: 99, drop: null }, LIMIT)).toEqual(["Your roster is full at 4 players. Pick someone to drop."]);
    expect(checkAcquire(FULL.map((p) => (p.playerId === 4 ? { ...p, locked: true } : p)), THEM, { add: 99, drop: 4 }, LIMIT)).toEqual([
      "Bench Two's game has started, so ESPN won't drop them this week.",
    ]);
    expect(checkAcquire(FULL, THEM, { add: 99, drop: 77 }, LIMIT)).toContain("The player you're dropping isn't on your team any more.");
    expect(checkAcquire(FULL, THEM, { add: 50, drop: 4 }, LIMIT)).toEqual(["That player is on Their Team now."]);
    expect(checkAcquire(FULL, THEM, { add: 3, drop: 4 }, LIMIT)).toEqual(["That player is already on your team."]);
  });
});

describe("acquireItems / acquireLanded", () => {
  it("builds ADD and DROP items for the user's team", () => {
    expect(acquireItems(1, { add: 99, drop: 4 })).toEqual([
      { playerId: 99, type: "ADD", toTeamId: 1 },
      { playerId: 4, type: "DROP", fromTeamId: 1 },
    ]);
    expect(acquireItems(1, { add: 99, drop: null })).toEqual([{ playerId: 99, type: "ADD", toTeamId: 1 }]);
  });

  it("reads the roster after for the player in and the drop gone", () => {
    expect(acquireLanded([{ playerId: 99 }, { playerId: 1 }], { add: 99, drop: 4 })).toEqual({ added: true, dropped: true });
    expect(acquireLanded([{ playerId: 4 }], { add: 99, drop: 4 })).toEqual({ added: false, dropped: false });
  });
});
