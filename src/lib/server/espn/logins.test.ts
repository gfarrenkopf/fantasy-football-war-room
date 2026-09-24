import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { espnLogins, users } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { deleteLogin, loadLogin, loginExpiry, loginStatus, markDisconnected, markVerified, purgeExpiredLogins, storeLogin } from "./logins";
import { mayUseSeason } from "./seasonAccess";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const KEY = randomBytes(32);
const LOGIN = { espnS2: "AEB-not-a-real-espn-s2-cookie-%2F%3D", swid: "{154E132F-8C13-4AC0-9DAC-20C2C5625594}" };
const extras = { season: 2026, consentVersion: 1 };
const now = new Date("2026-09-24T12:00:00Z");

describe("ESPN logins", () => {
  it("stores the login sealed, and opens it only for its own user under the right key", async () => {
    const userId = await createTestUser(db);
    const other = await createTestUser(db);
    await storeLogin(db, KEY, userId, LOGIN, extras, now);
    const [row] = await db.select().from(espnLogins).where(eq(espnLogins.userId, userId));
    expect(row.sealed).not.toContain(LOGIN.espnS2);
    expect(row.sealed).not.toContain(LOGIN.swid);
    expect(row.expiresAt).toEqual(loginExpiry(2026));
    expect(await loadLogin(db, KEY, userId, now)).toEqual(LOGIN);
    expect(await loadLogin(db, randomBytes(32), userId, now)).toBeNull();
    // A sealed value copied onto another user's row doesn't open.
    await db.insert(espnLogins).values({ ...row, userId: other });
    expect(await loadLogin(db, KEY, other, now)).toBeNull();
  });

  it("reports status without the login, and flips to disconnected when ESPN refuses it", async () => {
    const userId = await createTestUser(db);
    expect(await loginStatus(db, userId, now)).toBeNull();
    await storeLogin(db, KEY, userId, LOGIN, extras, now);
    await markVerified(db, userId, now);
    const status = await loginStatus(db, userId, now);
    expect(status).toEqual({ status: "connected", season: 2026, verifiedAt: now });
    expect(JSON.stringify(status)).not.toContain(LOGIN.espnS2);

    await markDisconnected(db, userId, now);
    expect((await loginStatus(db, userId, now))?.status).toBe("disconnected");
    expect(await loadLogin(db, KEY, userId, now)).toBeNull();

    // Connecting again replaces it and reconnects.
    await storeLogin(db, KEY, userId, LOGIN, extras, now);
    expect(await loginStatus(db, userId, now)).toMatchObject({ status: "connected", verifiedAt: null });
  });

  it("deletes on disconnect, with the account, and once the season is over", async () => {
    const a = await createTestUser(db);
    const b = await createTestUser(db);
    const c = await createTestUser(db);
    for (const u of [a, b, c]) await storeLogin(db, KEY, u, LOGIN, extras, now);

    expect(await deleteLogin(db, a)).toBe(true);
    expect(await deleteLogin(db, a)).toBe(false);

    await db.delete(users).where(eq(users.id, b));
    expect(await db.select().from(espnLogins).where(eq(espnLogins.userId, b))).toEqual([]);

    const afterSeason = new Date(loginExpiry(2026).getTime() + 1);
    expect(await loadLogin(db, KEY, c, afterSeason)).toBeNull();
    await purgeExpiredLogins(db, afterSeason);
    expect(await db.select().from(espnLogins).where(eq(espnLogins.userId, c))).toEqual([]);
  });

  it("expires after the fantasy season: February 1 of the next year", () => {
    expect(loginExpiry(2026).toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });
});

describe("mayUseSeason", () => {
  it("lets everyone in with no allowlist, and only the listed accounts with one", () => {
    expect(mayUseSeason([], null)).toBe(true);
    expect(mayUseSeason(["greg@apeman.tech"], "Greg@Apeman.tech")).toBe(true);
    expect(mayUseSeason(["greg@apeman.tech"], "someone@example.test")).toBe(false);
    expect(mayUseSeason(["greg@apeman.tech"], null)).toBe(false);
  });
});
