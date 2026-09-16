import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { standardRoster } from "@/lib/data";
import { drafts, leagues, users } from "./schema";
import { createTestDb, createTestUser } from "./testing";
import type { Db } from "./types";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const league = (id: string, userId: string) => ({
  id,
  userId,
  name: "Home league",
  season: 2026,
  datasetId: "2026-abc",
  settings: { teams: 12, mySlot: 1, scoring: "ppr" as const, valueThreshold: 10, roster: standardRoster() },
});

describe("database schema", () => {
  it("applies every migration to a fresh database", async () => {
    // createTestDb() ran them; the tables are queryable and empty.
    expect(await db.select().from(leagues)).toEqual([]);
  });

  it("round-trips league settings and draft state as JSON", async () => {
    const userId = await createTestUser(db);
    await db.insert(leagues).values(league("l1", userId));
    await db.insert(drafts).values({ leagueId: "l1", state: { version: 1, picks: [{ playerId: "a", mine: true }] } });
    const [row] = await db.select().from(drafts).where(eq(drafts.leagueId, "l1"));
    expect(row.state.picks).toEqual([{ playerId: "a", mine: true }]);
    expect(row.revision).toBe(0);
    const [l] = await db.select().from(leagues).where(eq(leagues.id, "l1"));
    expect(l.settings.roster).toHaveLength(16);
    expect(l.deletedAt).toBeNull();
  });

  it("rejects a league for a user that doesn't exist", async () => {
    await expect(db.insert(leagues).values(league("orphan", "no-such-user"))).rejects.toThrow();
  });

  it("deleting a user removes their leagues and drafts", async () => {
    const userId = await createTestUser(db);
    await db.insert(leagues).values(league("l2", userId));
    await db.insert(drafts).values({ leagueId: "l2", state: { version: 1, picks: [] } });
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(leagues).where(eq(leagues.id, "l2"))).toEqual([]);
    expect(await db.select().from(drafts).where(eq(drafts.leagueId, "l2"))).toEqual([]);
  });
});
