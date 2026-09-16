import { and, desc, eq } from "drizzle-orm";
import { entitlements, leagues } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import type { Purchase } from "@/lib/storage/types";

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

export type GrantResult =
  | "granted"
  /** Already recorded, e.g. Stripe retried the event. Nothing changed. */
  | "exists"
  /** No such league, or it isn't owned by that user. */
  | "no-league";

/**
 * Records a purchase. Idempotent: one row per league and kind, so a retried event is harmless.
 * A soft-deleted league still gets the grant (it was paid for, and restoring the league keeps it).
 */
export async function grantEntitlement(
  db: Db,
  grant: { leagueId: string; userId: string; kind: string; source: string; amountTotal: number | null; currency: string | null },
): Promise<GrantResult> {
  const [league] = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(and(eq(leagues.id, grant.leagueId), eq(leagues.userId, grant.userId)));
  if (!league) return "no-league";
  const inserted = await db
    .insert(entitlements)
    .values({ leagueId: grant.leagueId, kind: grant.kind, source: grant.source, amountTotal: grant.amountTotal, currency: grant.currency })
    .onConflictDoNothing()
    .returning({ kind: entitlements.kind });
  return inserted.length ? "granted" : "exists";
}

/** The user's purchases, newest first. Includes leagues deleted since, so the history stays complete. */
export async function listPurchases(db: Db, userId: string): Promise<Purchase[]> {
  const rows = await db
    .select({
      leagueId: entitlements.leagueId,
      kind: entitlements.kind,
      purchasedAt: entitlements.grantedAt,
      amountTotal: entitlements.amountTotal,
      currency: entitlements.currency,
      leagueName: leagues.name,
      season: leagues.season,
      deletedAt: leagues.deletedAt,
    })
    .from(entitlements)
    .innerJoin(leagues, eq(leagues.id, entitlements.leagueId))
    .where(eq(leagues.userId, userId))
    .orderBy(desc(entitlements.grantedAt));
  return rows.map(({ purchasedAt, deletedAt, ...row }) => ({ ...row, purchasedAt: purchasedAt.toISOString(), leagueDeleted: deletedAt !== null }));
}
