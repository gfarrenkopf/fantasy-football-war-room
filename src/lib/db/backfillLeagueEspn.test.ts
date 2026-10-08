import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findLeague } from "@/lib/server/leagues";
import { mintBridgeToken } from "@/lib/server/espn/bridgeTokens";
import { linkSeason } from "@/lib/server/espn/seasonLinks";
import { createTestLeague } from "@/lib/server/testLeagues";
import { createTestDb, createTestUser } from "./testing";
import type { Db } from "./types";

/**
 * drizzle/0022_backfill_league_espn.sql (APE-329) runs on a fresh database with nothing to backfill,
 * so it's run here again over leagues connected the old way.
 */
const MIGRATION = fileURLToPath(new URL("../../../drizzle/0022_backfill_league_espn.sql", import.meta.url));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const backfill = async () => {
  for (const statement of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
};

describe("backfilling leagues.espn (APE-329)", () => {
  it("marks season-linked leagues, then paired ones by their newest pairing, and leaves the rest", async () => {
    const userId = await createTestUser(db);
    const linked = await createTestLeague(db, userId);
    const paired = await createTestLeague(db, userId);
    const both = await createTestLeague(db, userId);
    const plain = await createTestLeague(db, userId);

    await linkSeason(db, userId, { leagueId: linked, espnLeagueId: "1", espnTeamId: 2, season: 2026 });
    await mintBridgeToken(db, { userId, leagueId: paired, espnLeagueId: "3", espnTeamId: 4, season: 2026 }, new Date("2026-08-01T00:00:00.000Z"));
    await mintBridgeToken(db, { userId, leagueId: paired, espnLeagueId: "5", espnTeamId: 6, season: 2026 }, new Date("2026-09-01T00:00:00.000Z"));
    await linkSeason(db, userId, { leagueId: both, espnLeagueId: "7", espnTeamId: 8, season: 2026 });
    await mintBridgeToken(db, { userId, leagueId: both, espnLeagueId: "9", espnTeamId: 10, season: 2026 });

    await backfill();
    expect((await findLeague(db, userId, linked))!.espn).toEqual({ espnLeagueId: "1", espnTeamId: 2, season: 2026 });
    expect((await findLeague(db, userId, paired))!.espn).toEqual({ espnLeagueId: "5", espnTeamId: 6, season: 2026 });
    expect((await findLeague(db, userId, both))!.espn).toEqual({ espnLeagueId: "7", espnTeamId: 8, season: 2026 });
    expect((await findLeague(db, userId, plain))!.espn).toBeNull();

    // Never overwrites a connection already made.
    await linkSeason(db, userId, { leagueId: paired, espnLeagueId: "11", espnTeamId: 12, season: 2026 });
    await backfill();
    expect((await findLeague(db, userId, paired))!.espn).toEqual({ espnLeagueId: "5", espnTeamId: 6, season: 2026 });
  });
});
