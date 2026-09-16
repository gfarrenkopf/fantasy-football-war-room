import { standardRoster } from "@/lib/data";
import type { Db } from "@/lib/db/types";
import { upsertLeague } from "./leagues";

let seq = 0;

/** Saves a league for a test user and returns its id. For tests only. */
export async function createTestLeague(db: Db, userId: string, name = "Home league"): Promise<string> {
  const id = `test-league-${++seq}-${crypto.randomUUID().slice(0, 8)}`;
  const now = "2026-09-01T00:00:00.000Z";
  await upsertLeague(db, userId, {
    id,
    name,
    season: 2026,
    datasetId: "2026-abc",
    settings: { teams: 12, mySlot: 3, scoring: "ppr", valueThreshold: 10, roster: standardRoster() },
    createdAt: now,
    updatedAt: now,
  });
  return id;
}
