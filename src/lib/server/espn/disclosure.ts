import { eq } from "drizzle-orm";
import { espnDisclosureAcks } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/** True when the user has acknowledged this version (or a later one) of the ESPN sync disclosure. */
export async function hasAcknowledgedDisclosure(db: Db, userId: string, version: number): Promise<boolean> {
  const [row] = await db.select({ version: espnDisclosureAcks.version }).from(espnDisclosureAcks).where(eq(espnDisclosureAcks.userId, userId));
  return !!row && row.version >= version;
}

/** Records the user's acknowledgement of a disclosure version. */
export async function acknowledgeDisclosure(db: Db, userId: string, version: number, now = new Date()): Promise<void> {
  await db
    .insert(espnDisclosureAcks)
    .values({ userId, version, acknowledgedAt: now })
    .onConflictDoUpdate({ target: espnDisclosureAcks.userId, set: { version, acknowledgedAt: now } });
}
