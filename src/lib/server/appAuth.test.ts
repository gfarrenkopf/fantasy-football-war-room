import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import {
  APP_SESSION_DAYS,
  AppAuthError,
  bearerToken,
  createAppSession,
  createHandoffCode,
  deleteAppSession,
  redeemEmailToken,
  redeemHandoffCode,
  userForAppleIdentity,
  userForBearer,
  verifyAppleIdentityToken,
  type AppleKeys,
} from "./appAuth";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const DAY = 24 * 60 * 60 * 1000;

describe("app sessions", () => {
  it("issues a 32-byte token that resolves to its user until it expires", async () => {
    const userId = await createTestUser(db, "bearer@example.test");
    const now = new Date("2026-10-13T12:00:00Z");
    const { token, expiresAt } = await createAppSession(db, userId, now);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(expiresAt.getTime() - now.getTime()).toBe(APP_SESSION_DAYS * DAY);
    expect(await userForBearer(db, token, now)).toEqual({ userId, email: "bearer@example.test" });
    expect(await userForBearer(db, token, new Date(expiresAt.getTime() + 1))).toBeNull();
  });

  it("rejects unknown and empty tokens", async () => {
    expect(await userForBearer(db, "not-a-token")).toBeNull();
    expect(await userForBearer(db, "")).toBeNull();
  });

  it("slides the expiry forward once half of it is used", async () => {
    const userId = await createTestUser(db);
    const start = new Date("2026-10-01T00:00:00Z");
    const { token, expiresAt } = await createAppSession(db, userId, start);
    const expiry = async () => (await db.select().from(sessions).where(eq(sessions.sessionToken, token)))[0].expires.getTime();

    await userForBearer(db, token, new Date(start.getTime() + 10 * DAY));
    expect(await expiry()).toBe(expiresAt.getTime());

    const later = new Date(start.getTime() + 60 * DAY);
    await userForBearer(db, token, later);
    expect(await expiry()).toBe(later.getTime() + APP_SESSION_DAYS * DAY);
  });

  it("signs out by deleting the session", async () => {
    const userId = await createTestUser(db);
    const { token } = await createAppSession(db, userId);
    await deleteAppSession(db, token);
    expect(await userForBearer(db, token)).toBeNull();
  });

  it("reads only Bearer authorization headers", () => {
    const req = (authorization?: string) => new Request("http://x/", { headers: authorization ? { authorization } : {} });
    expect(bearerToken(req("Bearer abc"))).toBe("abc");
    expect(bearerToken(req("bearer abc"))).toBe("abc");
    expect(bearerToken(req("Basic abc"))).toBeNull();
    expect(bearerToken(req())).toBeNull();
  });
});

describe("Google hand-off codes", () => {
  it("work once", async () => {
    const userId = await createTestUser(db);
    const code = await createHandoffCode(db, userId);
    expect(await redeemHandoffCode(db, code)).toBe(userId);
    expect(await redeemHandoffCode(db, code)).toBeNull();
  });

  it("expire after 60 seconds", async () => {
    const userId = await createTestUser(db);
    const now = new Date("2026-10-13T12:00:00Z");
    const code = await createHandoffCode(db, userId, now);
    expect(await redeemHandoffCode(db, code, new Date(now.getTime() + 61_000))).toBeNull();
  });

  it("are stored hashed, and an unknown code finds nothing", async () => {
    const userId = await createTestUser(db);
    const code = await createHandoffCode(db, userId);
    const stored = await db.select().from(verificationTokens).where(eq(verificationTokens.identifier, `app-handoff:${userId}`));
    expect(stored[0].token).not.toBe(code);
    expect(await redeemHandoffCode(db, "nope")).toBeNull();
  });
});

describe("magic links opened in the app", () => {
  const secret = "test-secret";
  const invite = async (email: string, token: string, expires = new Date(Date.now() + 60_000)) =>
    db.insert(verificationTokens).values({ identifier: email, token: createHash("sha256").update(`${token}${secret}`).digest("hex"), expires });

  it("signs in to the account with that email, once", async () => {
    const userId = await createTestUser(db, "link@example.test");
    await invite("link@example.test", "tok1");
    expect(await redeemEmailToken(db, { email: "Link@Example.test", token: "tok1", secret })).toEqual({ userId, isNew: false });
    expect(await redeemEmailToken(db, { email: "link@example.test", token: "tok1", secret })).toBeNull();
  });

  it("creates a verified account for a new address", async () => {
    await invite("new@example.test", "tok2");
    const result = await redeemEmailToken(db, { email: "new@example.test", token: "tok2", secret });
    expect(result?.isNew).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.id, result!.userId));
    expect(user.emailVerified).toBeInstanceOf(Date);
  });

  it("rejects expired links and the wrong secret", async () => {
    await invite("old@example.test", "tok3", new Date(Date.now() - 1000));
    expect(await redeemEmailToken(db, { email: "old@example.test", token: "tok3", secret })).toBeNull();
    await invite("other@example.test", "tok4");
    expect(await redeemEmailToken(db, { email: "other@example.test", token: "tok4", secret: "wrong" })).toBeNull();
  });
});

describe("Sign in with Apple identity tokens", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256" };
  const keys: AppleKeys = async () => [jwk];
  const now = 1_760_000_000;
  const nonce = "raw-nonce";
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tokenWith = (claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) => {
    const input = `${b64({ alg: "RS256", kid: "test-kid", ...header })}.${b64({
      iss: "https://appleid.apple.com",
      aud: "tech.apeman.draftroom",
      exp: now + 600,
      sub: "000123.abc",
      email: "Ada@Example.test",
      email_verified: "true",
      nonce: createHash("sha256").update(nonce).digest("hex"),
      ...claims,
    })}`;
    return `${input}.${sign("sha256", Buffer.from(input), privateKey).toString("base64url")}`;
  };

  it("accepts a token signed by Apple's key for this app", async () => {
    expect(await verifyAppleIdentityToken(tokenWith(), { nonce, keys, now })).toEqual({ sub: "000123.abc", email: "ada@example.test", emailVerified: true });
  });

  it.each([
    ["another app's audience", { aud: "com.example.other" }],
    ["another issuer", { iss: "https://evil.example" }],
    ["an expired token", { exp: now - 1 }],
    ["a different nonce", { nonce: createHash("sha256").update("other").digest("hex") }],
  ])("rejects %s", async (_label, claims) => {
    await expect(verifyAppleIdentityToken(tokenWith(claims), { nonce, keys, now })).rejects.toBeInstanceOf(AppAuthError);
  });

  it("rejects a tampered token and an unknown key", async () => {
    const [h, , s] = tokenWith().split(".");
    await expect(verifyAppleIdentityToken(`${h}.${b64({ sub: "someone-else" })}.${s}`, { nonce, keys, now })).rejects.toBeInstanceOf(AppAuthError);
    await expect(verifyAppleIdentityToken(tokenWith({}, { kid: "rotated" }), { nonce, keys, now })).rejects.toThrow("Unknown signing key");
  });

  it("refetches keys once when a token names a new one", async () => {
    let fetches = 0;
    const rotating: AppleKeys = async ({ refresh }) => {
      fetches++;
      return refresh ? [jwk] : [];
    };
    await verifyAppleIdentityToken(tokenWith(), { nonce, keys: rotating, now });
    expect(fetches).toBe(2);
  });
});

describe("the account an Apple identity signs in to", () => {
  it("links to the existing account with the same verified email, and keeps using it", async () => {
    const userId = await createTestUser(db, "same@example.test");
    const identity = { sub: "apple-1", email: "same@example.test", emailVerified: true };
    expect(await userForAppleIdentity(db, identity, "Ada Lovelace")).toEqual({ userId, isNew: false });
    expect(await userForAppleIdentity(db, { ...identity, email: null }, null)).toEqual({ userId, isNew: false });
    const linked = await db.select().from(accounts).where(and(eq(accounts.provider, "apple"), eq(accounts.providerAccountId, "apple-1")));
    expect(linked).toHaveLength(1);
    expect((await db.select().from(users).where(eq(users.id, userId)))[0].name).toBe("Ada Lovelace");
  });

  it("creates a new account for a relay address, with the first-consent name", async () => {
    const result = await userForAppleIdentity(db, { sub: "apple-2", email: "x1@privaterelay.appleid.com", emailVerified: true }, "Grace Hopper");
    expect(result.isNew).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user).toMatchObject({ email: "x1@privaterelay.appleid.com", name: "Grace Hopper" });
  });

  it("never links by an unverified email", async () => {
    const userId = await createTestUser(db, "unverified@example.test");
    const result = await userForAppleIdentity(db, { sub: "apple-3", email: "unverified@example.test", emailVerified: false }, null);
    expect(result.userId).not.toBe(userId);
  });
});
