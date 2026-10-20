import { and, eq, isNull } from "drizzle-orm";
import { users, type SeasonAccessVia } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/**
 * Who may use in-season features (Epic 10, APE-341). SEASON_ACCESS decides, apart from live draft
 * sync's ESPN_SYNC_ALLOWLIST:
 *
 * - `open` (the beta): every signed-in account. Connecting ESPN stamps the account, so it stays in.
 * - `closed`: SEASON_ALLOWLIST, plus every stamped account: the beta's testers and hand invites.
 */
export type SeasonAccessMode = "open" | "closed";

/** Pure, so every combination is testable. `stamped` is looked up only when the list doesn't decide. */
export async function decideSeasonAccess({
  mode,
  allowlist,
  email,
  stamped,
}: {
  mode: SeasonAccessMode;
  allowlist: readonly string[];
  email: string | null;
  stamped: () => Promise<boolean>;
}): Promise<boolean> {
  if (mode === "open") return true;
  if (email !== null && allowlist.includes(email.toLowerCase())) return true;
  return stamped();
}

/** The account's season access stamp, or null when it has none. */
export async function seasonAccessStamp(db: Db, userId: string): Promise<{ at: Date; via: SeasonAccessVia | null } | null> {
  const [row] = await db.select({ at: users.seasonAccessAt, via: users.seasonAccessVia }).from(users).where(eq(users.id, userId));
  return row?.at ? { at: row.at, via: row.via } : null;
}

/** Stamps the account as a beta tester, unless it's already stamped. Called on connecting ESPN while open. */
export async function stampSeasonAccess(db: Db, userId: string, now = new Date()): Promise<void> {
  await db
    .update(users)
    .set({ seasonAccessAt: now, seasonAccessVia: "open" })
    .where(and(eq(users.id, userId), isNull(users.seasonAccessAt)));
}

/** Joined while the beta was open, so it gets the 2026 season's AI free (seasonAi.ts). Not hand invites. */
export async function isSeasonBetaTester(db: Db, userId: string): Promise<boolean> {
  return (await seasonAccessStamp(db, userId))?.via === "open";
}
