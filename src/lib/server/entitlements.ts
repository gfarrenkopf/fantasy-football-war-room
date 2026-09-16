import { and, eq } from "drizzle-orm";
import { entitlements } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/**
 * What leagues have paid for (Epic 4). Rows are written only by the Stripe webhook; nothing here
 * reads `config`, so when payments are off callers simply don't ask.
 */

/** A league's one-time season pass: unlocks the AI plan for that league. */
export const SEASON_PASS = "season_pass";

export async function hasEntitlement(db: Db, leagueId: string, kind: string): Promise<boolean> {
  const [row] = await db
    .select({ kind: entitlements.kind })
    .from(entitlements)
    .where(and(eq(entitlements.leagueId, leagueId), eq(entitlements.kind, kind)));
  return !!row;
}
