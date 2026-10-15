import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { userPrefs } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { emailTurnedOff, resolveAlerts, type AlertChannel, type AlertKind, type StoredAlerts } from "@/lib/season/alerts";
import { hasDevice } from "./devices";

/**
 * The season emails' master switch (11.3), from before each alert had its own setting (21.3). Only
 * the original unsubscribe link turns it off now; resolveAlerts() applies it to untouched alerts.
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

/** How each season alert reaches the user (21.3), with the defaults filled in. */
export async function alertChannels(db: Db, userId: string, now = new Date()): Promise<Record<AlertKind, AlertChannel>> {
  const [[row], device] = await Promise.all([
    db.select({ alerts: userPrefs.alerts, seasonEmails: userPrefs.seasonEmails }).from(userPrefs).where(eq(userPrefs.userId, userId)),
    hasDevice(db, userId, now),
  ]);
  return resolveAlerts(row?.alerts ?? {}, { seasonEmails: row?.seasonEmails ?? true, hasDevice: device });
}

/** Saves the user's choice for some alerts, keeping the rest. */
export async function setAlertChannels(db: Db, userId: string, changes: StoredAlerts, now = new Date()): Promise<void> {
  await db
    .insert(userPrefs)
    .values({ userId, alerts: changes, updatedAt: now })
    .onConflictDoUpdate({ target: userPrefs.userId, set: { alerts: sql`${userPrefs.alerts} || ${JSON.stringify(changes)}::jsonb`, updatedAt: now } });
}

/**
 * An email's unsubscribe link: email off for that alert, push left as it was. A link from before
 * alerts had their own settings names none, and turns email off for all of them.
 */
export async function unsubscribe(db: Db, userId: string, kind: AlertKind | null, now = new Date()): Promise<void> {
  const channels = await alertChannels(db, userId, now);
  await setAlertChannels(db, userId, emailTurnedOff(channels, kind ? [kind] : undefined), now);
  if (!kind) await setSeasonEmails(db, userId, false, now);
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

/** The version of the consent to change their ESPN team the user agreed to (12.1, Epic 13), or null if they never have. */
export async function writeConsent(db: Db, userId: string): Promise<number | null> {
  const [row] = await db.select({ version: userPrefs.lineupWriteConsent }).from(userPrefs).where(eq(userPrefs.userId, userId));
  return row?.version ?? null;
}

export async function agreeToWrites(db: Db, userId: string, version: number, now = new Date()): Promise<void> {
  await db
    .insert(userPrefs)
    .values({ userId, lineupWriteConsent: version, updatedAt: now })
    .onConflictDoUpdate({ target: userPrefs.userId, set: { lineupWriteConsent: version, updatedAt: now } });
}
