import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { deviceTokens, sessions, type ApnsEnvironment } from "@/lib/db/schema";

/**
 * The iPhones each user gets pushes on (21.1). The app registers its APNs device token on every
 * launch, under the app session it's signed in with; see `deviceTokens` in the schema for why the
 * session owns the row.
 */

export type DeviceRegistration = { token: string; environment: ApnsEnvironment; appVersion: string; startToken?: string | null };
export type Device = { token: string; environment: ApnsEnvironment };

/** APNs device tokens are hex. Apple says not to rely on the length, so this only bounds it. */
const TOKEN = /^[0-9a-f]{32,400}$/;

/** A registration body → its fields, or the reason it's rejected. Tokens are lowercased. */
export function parseRegistration(body: unknown): { ok: true; value: DeviceRegistration } | { ok: false; error: string } {
  const b = (body ?? {}) as { token?: unknown; environment?: unknown; appVersion?: unknown };
  const token = typeof b.token === "string" ? b.token.toLowerCase() : "";
  if (!TOKEN.test(token)) return { ok: false, error: "token must be an APNs device token (hex)" };
  if (b.environment !== "sandbox" && b.environment !== "production") return { ok: false, error: 'environment must be "sandbox" or "production"' };
  const appVersion = typeof b.appVersion === "string" ? b.appVersion.slice(0, 32) : "";
  // The Live Activity push-to-start token (21.5), when this iPhone has one: same format as the device token.
  const start = (b as { startToken?: unknown }).startToken;
  const startToken = typeof start === "string" && TOKEN.test(start.toLowerCase()) ? start.toLowerCase() : null;
  if (start !== undefined && start !== null && !startToken) return { ok: false, error: "startToken must be an APNs token (hex)" };
  return { ok: true, value: { token, environment: b.environment, appVersion, ...(start !== undefined ? { startToken } : {}) } };
}

/** Registers or refreshes a token. A token already registered by another account or session moves to this one. */
export async function registerDevice(db: Db, userId: string, sessionToken: string, device: DeviceRegistration, now = new Date()): Promise<void> {
  await db
    .insert(deviceTokens)
    .values({ ...device, userId, sessionToken, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      set: {
        userId,
        sessionToken,
        environment: device.environment,
        appVersion: device.appVersion,
        ...(device.startToken !== undefined ? { startToken: device.startToken } : {}),
        lastSeenAt: now,
        createdAt: sql`case when ${deviceTokens.userId} = ${userId} then ${deviceTokens.createdAt} else ${now} end`,
      },
    });
}

/** Removes one of the user's tokens. Someone else's token, or an unknown one, is a no-op. */
export async function removeDevice(db: Db, userId: string, token: string): Promise<void> {
  await db.delete(deviceTokens).where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token.toLowerCase())));
}

/** Removes a token APNs reported dead, whoever it belonged to. */
export async function forgetDevice(db: Db, token: string): Promise<void> {
  await db.delete(deviceTokens).where(eq(deviceTokens.token, token));
}

/** The user's devices whose app session is still live: an expired session gets no pushes. */
export async function devicesFor(db: Db, userId: string, now = new Date()): Promise<Device[]> {
  return db
    .select({ token: deviceTokens.token, environment: deviceTokens.environment })
    .from(deviceTokens)
    .innerJoin(sessions, eq(sessions.sessionToken, deviceTokens.sessionToken))
    .where(and(eq(deviceTokens.userId, userId), gt(sessions.expires, now)))
    .orderBy(deviceTokens.createdAt);
}

/** The push-to-start tokens of the user's signed-in iPhones, for starting a Live Activity from the server (21.5). */
export async function startTokensFor(db: Db, userId: string, now = new Date()): Promise<Device[]> {
  const rows = await db
    .select({ token: deviceTokens.startToken, environment: deviceTokens.environment })
    .from(deviceTokens)
    .innerJoin(sessions, eq(sessions.sessionToken, deviceTokens.sessionToken))
    .where(and(eq(deviceTokens.userId, userId), gt(sessions.expires, now), isNotNull(deviceTokens.startToken)));
  return rows.flatMap((r) => (r.token ? [{ token: r.token, environment: r.environment }] : []));
}

/** Whether the user has the app on any device, signed in. Decides the default alert channel (21.3). */
export async function hasDevice(db: Db, userId: string, now = new Date()): Promise<boolean> {
  return (await devicesFor(db, userId, now)).length > 0;
}
