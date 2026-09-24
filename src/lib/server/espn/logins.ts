import { and, eq, lt } from "drizzle-orm";
import { espnLogins, type EspnLoginStatus } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { open, seal } from "./secretBox";

/**
 * The ESPN login a user handed War Room for the season (10.2): their `espn_s2` and SWID cookies,
 * sealed with ESPN_CODE_KEY. One per user, since one ESPN login covers all their leagues.
 *
 * These cookies are a credential for the user's whole ESPN account: nothing here logs them, and
 * nothing returns them except `loadLogin`, which only the server-side ESPN reader calls.
 */

export interface EspnLogin {
  espnS2: string;
  /** The user's ESPN member id, `{GUID}`. */
  swid: string;
}

export interface LoginStatus {
  status: EspnLoginStatus;
  season: number;
  verifiedAt: Date | null;
}

/** Bound into the seal, so a sealed value only opens on the row it was written for. */
const context = (userId: string) => `espn-login:${userId}`;

/**
 * When a season's login is deleted: February 1 after it, safely past the last fantasy playoff week
 * (ESPN's season ends in early January) and before anyone needs it for next season.
 */
export function loginExpiry(season: number): Date {
  return new Date(Date.UTC(season + 1, 1, 1));
}

/** Stores (or replaces) the user's login as `connected`. */
export async function storeLogin(db: Db, key: Buffer, userId: string, login: EspnLogin, extras: { season: number; consentVersion: number }, now = new Date()): Promise<void> {
  const values = {
    sealed: seal(JSON.stringify({ espnS2: login.espnS2, swid: login.swid }), key, context(userId)),
    season: extras.season,
    consentVersion: extras.consentVersion,
    status: "connected" as const,
    verifiedAt: null,
    updatedAt: now,
    expiresAt: loginExpiry(extras.season),
  };
  await db
    .insert(espnLogins)
    .values({ userId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: espnLogins.userId, set: values });
}

/** The user's login, or null if there's none, it has expired or been disconnected, or it won't open under this key. */
export async function loadLogin(db: Db, key: Buffer, userId: string, now = new Date()): Promise<EspnLogin | null> {
  const [row] = await db.select().from(espnLogins).where(eq(espnLogins.userId, userId));
  if (!row || row.expiresAt <= now || row.status !== "connected") return null;
  const plain = open(row.sealed, key, context(userId));
  if (!plain) return null;
  const { espnS2, swid } = JSON.parse(plain) as EspnLogin;
  return { espnS2, swid };
}

/** Where the user's login stands, without opening it. Null when there's none (or it has expired). */
export async function loginStatus(db: Db, userId: string, now = new Date()): Promise<LoginStatus | null> {
  const [row] = await db
    .select({ status: espnLogins.status, season: espnLogins.season, verifiedAt: espnLogins.verifiedAt, expiresAt: espnLogins.expiresAt })
    .from(espnLogins)
    .where(eq(espnLogins.userId, userId));
  return row && row.expiresAt > now ? { status: row.status, season: row.season, verifiedAt: row.verifiedAt } : null;
}

/** ESPN accepted the login: note when, so the page can say how fresh the connection is. */
export async function markVerified(db: Db, userId: string, now = new Date()): Promise<void> {
  await db
    .update(espnLogins)
    .set({ verifiedAt: now, updatedAt: now })
    .where(and(eq(espnLogins.userId, userId), eq(espnLogins.status, "connected")));
}

/** ESPN refused the login (401/403): stop using it until the user connects again. */
export async function markDisconnected(db: Db, userId: string, now = new Date()): Promise<void> {
  await db.update(espnLogins).set({ status: "disconnected", updatedAt: now }).where(eq(espnLogins.userId, userId));
}

/** Forgets the user's login. Returns whether there was one. */
export async function deleteLogin(db: Db, userId: string): Promise<boolean> {
  const deleted = await db.delete(espnLogins).where(eq(espnLogins.userId, userId)).returning({ userId: espnLogins.userId });
  return deleted.length > 0;
}

/** Deletes logins past their season. */
export async function purgeExpiredLogins(db: Db, now = new Date()): Promise<void> {
  await db.delete(espnLogins).where(lt(espnLogins.expiresAt, now));
}
