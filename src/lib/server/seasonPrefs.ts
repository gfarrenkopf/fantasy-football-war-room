import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { userPrefs } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/**
 * Whether a user gets the Sunday job's emails (11.3): "Your Sunday lineup is ready", and the
 * reconnect email. On unless they opt out, on the season page or with the email's unsubscribe link.
 */

export async function wantsSeasonEmails(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ on: userPrefs.seasonEmails }).from(userPrefs).where(eq(userPrefs.userId, userId));
  return row?.on ?? true;
}

export async function setSeasonEmails(db: Db, userId: string, on: boolean, now = new Date()): Promise<void> {
  await db
    .insert(userPrefs)
    .values({ userId, seasonEmails: on, updatedAt: now })
    .onConflictDoUpdate({ target: userPrefs.userId, set: { seasonEmails: on, updatedAt: now } });
}

const PURPOSE = "season-emails-unsubscribe";

/**
 * The token in an email's unsubscribe link, so it works without signing in: an HMAC of the user id
 * under the server's secret. It only ever turns season emails off.
 */
export function unsubscribeToken(secret: string, userId: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}:${userId}`).digest("base64url");
}

export function verifyUnsubscribeToken(secret: string, userId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(secret, userId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The lineup write-back consent version the user agreed to (12.1), or null if they never have. */
export async function lineupWriteConsent(db: Db, userId: string): Promise<number | null> {
  const [row] = await db.select({ version: userPrefs.lineupWriteConsent }).from(userPrefs).where(eq(userPrefs.userId, userId));
  return row?.version ?? null;
}

export async function agreeToLineupWrites(db: Db, userId: string, version: number, now = new Date()): Promise<void> {
  await db
    .insert(userPrefs)
    .values({ userId, lineupWriteConsent: version, updatedAt: now })
    .onConflictDoUpdate({ target: userPrefs.userId, set: { lineupWriteConsent: version, updatedAt: now } });
}
