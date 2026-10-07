import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { listLineupMoves, recordLineupMoves } from "./lineupMoves";
import { createTestLeague } from "./testLeagues";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

async function league(name = "Moves") {
  const userId = await createTestUser(db);
  return createTestLeague(db, userId, name);
}

describe("Draft Room's lineup moves (APE-256)", () => {
  it("keeps each week's moves for its own league, oldest first", async () => {
    const mine = await league();
    const other = await league("Other");
    await recordLineupMoves(db, mine, 2026, 5, [{ playerId: 1, from: "BN", to: "RB", gain: 4.2 }], new Date("2026-10-04T15:00:00Z"));
    await recordLineupMoves(db, mine, 2026, 5, [{ playerId: 2, from: "BN", to: "FLEX", gain: 1.5 }], new Date("2026-10-04T16:00:00Z"));
    await recordLineupMoves(db, mine, 2026, 6, [{ playerId: 3, from: "BN", to: "WR", gain: 2 }]);
    await recordLineupMoves(db, other, 2026, 5, [{ playerId: 9, from: "BN", to: "QB", gain: 8 }]);
    expect(await listLineupMoves(db, mine, 2026, 5)).toEqual([
      { playerId: 1, slot: "RB", gain: 4.2 },
      { playerId: 2, slot: "FLEX", gain: 1.5 },
    ]);
    expect(await listLineupMoves(db, mine, 2026, 7)).toEqual([]);
  });

  it("replaces a player's move when he's moved again the same week", async () => {
    const id = await league();
    await recordLineupMoves(db, id, 2026, 5, [{ playerId: 1, from: "BN", to: "RB", gain: 4.2 }]);
    await recordLineupMoves(db, id, 2026, 5, [{ playerId: 1, from: "RB", to: "FLEX", gain: 2.5 }]);
    expect(await listLineupMoves(db, id, 2026, 5)).toEqual([{ playerId: 1, slot: "FLEX", gain: 2.5 }]);
  });
});
