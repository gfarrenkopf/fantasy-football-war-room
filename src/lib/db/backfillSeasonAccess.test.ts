import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seasonAccessStamp } from "@/lib/server/espn/seasonAccess";
import { linkSeason } from "@/lib/server/espn/seasonLinks";
import { createTestLeague } from "@/lib/server/testLeagues";
import { espnSeasonLinks, users } from "./schema";
import { createTestDb, createTestUser } from "./testing";
import type { Db } from "./types";

/**
 * drizzle/0028_backfill_season_access.sql (APE-341) runs on a fresh database with nothing to
 * backfill, so it's run here again over accounts that connected a season before the stamp existed.
 */
const MIGRATION = fileURLToPath(new URL("../../../drizzle/0028_backfill_season_access.sql", import.meta.url));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const backfill = async () => {
  for (const statement of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
};

describe("backfilling users.season_access_at (APE-341)", () => {
  it("stamps accounts with a season link as beta testers, at their first link, and leaves the rest", async () => {
    const tester = await createTestUser(db);
    const first = await createTestLeague(db, tester);
    const second = await createTestLeague(db, tester);
    await linkSeason(db, tester, { leagueId: first, espnLeagueId: "1", espnTeamId: 2, season: 2026 });
    await linkSeason(db, tester, { leagueId: second, espnLeagueId: "3", espnTeamId: 4, season: 2026 });
    const firstAt = new Date("2026-09-10T12:00:00.000Z");
    await db.update(espnSeasonLinks).set({ createdAt: firstAt }).where(eq(espnSeasonLinks.leagueId, first));

    const invited = await createTestUser(db);
    const invitedLeague = await createTestLeague(db, invited);
    await linkSeason(db, invited, { leagueId: invitedLeague, espnLeagueId: "5", espnTeamId: 6, season: 2026 });
    const invitedAt = new Date("2026-11-01T12:00:00.000Z");
    await db.update(users).set({ seasonAccessAt: invitedAt, seasonAccessVia: "invite" }).where(eq(users.id, invited));

    const never = await createTestUser(db);

    await backfill();
    expect(await seasonAccessStamp(db, tester)).toEqual({ at: firstAt, via: "open" });
    expect(await seasonAccessStamp(db, invited)).toEqual({ at: invitedAt, via: "invite" });
    expect(await seasonAccessStamp(db, never)).toBeNull();
  });
});
