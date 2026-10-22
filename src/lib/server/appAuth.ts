import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

/**
 * Sign-in for the iPhone app (APE-372). The app can't hold Auth.js's session cookie, so each sign-in
 * method ends in a token exchange that creates a row in the same `sessions` table the web uses and
 * hands its token to the app, which sends it back as `Authorization: Bearer <token>` (see withUser()).
 * One table means signing out, account deletion and session expiry work the same for both.
 *
 * Pure database code with injected clocks and key fetchers, so it's testable on PGlite.
 */

/** App sessions last longer than the web's 30 days: a phone stays signed in. Each use within the last half extends it. */
export const APP_SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AppUser = { userId: string; email: string | null };

/** A new session for the app. The token is 32 random bytes, stored the way Auth.js stores its session tokens. */
export async function createAppSession(db: Db, userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + APP_SESSION_DAYS * DAY_MS);
  await db.insert(sessions).values({ sessionToken: token, userId, expires: expiresAt });
  return { token, expiresAt };
}

/** The user a Bearer token belongs to, or null when it's unknown or expired. Slides the expiry forward like Auth.js's updateAge. */
export async function userForBearer(db: Db, token: string, now = new Date()): Promise<AppUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({ userId: sessions.userId, email: users.email, expires: sessions.expires })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.sessionToken, token), gt(sessions.expires, now)))
    .limit(1);
  if (!row) return null;
  if (row.expires.getTime() - now.getTime() < (APP_SESSION_DAYS / 2) * DAY_MS) {
    await db
      .update(sessions)
      .set({ expires: new Date(now.getTime() + APP_SESSION_DAYS * DAY_MS) })
      .where(eq(sessions.sessionToken, token));
  }
  return { userId: row.userId, email: row.email };
}

/** Signs the app out: deletes its session row. Unknown tokens are a no-op. */
export async function deleteAppSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.sessionToken, token));
}

/** `Authorization: Bearer <token>` → the token, or null when the header is absent or another scheme. */
export function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

/* ---------- Sign in with Apple ---------- */

/** The app's bundle ID: the audience of the identity tokens Apple issues to it. */
export const APPLE_APP_AUDIENCE = "tech.apeman.draftroom";
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

export class AppAuthError extends Error {}

type Jwk = JsonWebKey & { kid?: string; alg?: string };
export type AppleKeys = (opts: { refresh: boolean }) => Promise<Jwk[]>;

/** Apple's signing keys, cached for an hour; refetched early when a token names a key we don't have (Apple rotates them). */
export function appleKeysFrom(fetchImpl: typeof fetch = fetch): AppleKeys {
  let cached: { at: number; keys: Jwk[] } | undefined;
  return async ({ refresh }) => {
    if (cached && !refresh && Date.now() - cached.at < 60 * 60 * 1000) return cached.keys;
    const res = await fetchImpl(APPLE_KEYS_URL);
    if (!res.ok) throw new AppAuthError(`Apple keys: HTTP ${res.status}`);
    const { keys } = (await res.json()) as { keys: Jwk[] };
    cached = { at: Date.now(), keys };
    return keys;
  };
}

export type AppleIdentity = { sub: string; email: string | null; emailVerified: boolean };

/**
 * Checks an identity token from ASAuthorizationAppleIDCredential: Apple's RS256 signature, issuer,
 * audience (the app's bundle ID), expiry, and the nonce. The app asks Apple to embed the SHA-256 of
 * a random nonce and sends us the raw nonce, so a token lifted from elsewhere can't be replayed here.
 */
export async function verifyAppleIdentityToken(
  idToken: string,
  opts: { nonce: string; keys: AppleKeys; audience?: string; now?: number },
): Promise<AppleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new AppAuthError("Malformed identity token");
  const [h, c, sig] = parts;
  let header: { alg?: string; kid?: string };
  let claims: { iss?: string; aud?: string | string[]; exp?: number; sub?: string; email?: string; email_verified?: boolean | string; nonce?: string };
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString());
    claims = JSON.parse(Buffer.from(c, "base64url").toString());
  } catch {
    throw new AppAuthError("Malformed identity token");
  }
  if (header.alg !== "RS256" || !header.kid) throw new AppAuthError("Unexpected token algorithm");

  let jwk = (await opts.keys({ refresh: false })).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await opts.keys({ refresh: true })).find((k) => k.kid === header.kid);
  if (!jwk) throw new AppAuthError("Unknown signing key");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  if (!verify("sha256", Buffer.from(`${h}.${c}`), key, Buffer.from(sig, "base64url"))) throw new AppAuthError("Bad signature");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const audience = opts.audience ?? APPLE_APP_AUDIENCE;
  if (claims.iss !== APPLE_ISSUER) throw new AppAuthError("Wrong issuer");
  if (!(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience)) throw new AppAuthError("Wrong audience");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new AppAuthError("Token expired");
  if (!claims.sub) throw new AppAuthError("Token has no subject");
  const expected = createHash("sha256").update(opts.nonce).digest("hex");
  if (!claims.nonce || !safeEqual(claims.nonce, expected)) throw new AppAuthError("Nonce mismatch");

  return {
    sub: claims.sub,
    email: claims.email?.toLowerCase() ?? null,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
  };
}

/**
 * The account an Apple identity signs in to, the way the web Apple provider does it (Auth.js with
 * allowDangerousEmailAccountLinking; see appleProvider() for why linking by email is safe for Apple):
 * the account already linked to this Apple ID, else the account with the same verified email (now
 * linked), else a new account. The name is Apple's first-consent name, kept only by an unnamed account.
 */
export async function userForAppleIdentity(db: Db, identity: AppleIdentity, name: string | null): Promise<{ userId: string; isNew: boolean }> {
  return db.transaction(async (tx) => {
    const [linked] = await tx
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(and(eq(accounts.provider, "apple"), eq(accounts.providerAccountId, identity.sub)))
      .limit(1);
    if (linked) {
      if (name) await tx.update(users).set({ name }).where(and(eq(users.id, linked.userId), isNull(users.name)));
      return { userId: linked.userId, isNew: false };
    }

    const email = identity.email && identity.emailVerified ? identity.email : null;
    let userId: string | undefined;
    let isNew = false;
    if (email) {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      userId = existing?.id;
      if (userId && name) await tx.update(users).set({ name }).where(and(eq(users.id, userId), isNull(users.name)));
    }
    if (!userId) {
      const [created] = await tx.insert(users).values({ email, name, emailVerified: email ? new Date() : null }).returning({ id: users.id });
      userId = created.id;
      isNew = true;
    }
    await tx.insert(accounts).values({ userId, type: "oidc", provider: "apple", providerAccountId: identity.sub });
    return { userId, isNew };
  });
}

/* ---------- Google: the hand-off from the system browser ---------- */

/*
 * Google blocks OAuth in embedded web views, so the app runs the web's own Google sign-in in an
 * ASWebAuthenticationSession. When it finishes, /api/v1/auth/handoff turns that browser session into
 * a one-time code and redirects to the app's URL scheme with it; the app trades the code for a token.
 * Codes live in Auth.js's verification_tokens table under their own identifier prefix (no email
 * starts with it), hashed, for 60 seconds, and are deleted as they're used.
 */
const HANDOFF_PREFIX = "app-handoff:";
export const HANDOFF_SECONDS = 60;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createHandoffCode(db: Db, userId: string, now = new Date()): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.insert(verificationTokens).values({
    identifier: `${HANDOFF_PREFIX}${userId}`,
    token: sha256(code),
    expires: new Date(now.getTime() + HANDOFF_SECONDS * 1000),
  });
  return code;
}

/** The user a hand-off code was made for, or null when it's unknown, used or expired. A code works once. */
export async function redeemHandoffCode(db: Db, code: string, now = new Date()): Promise<string | null> {
  if (!code) return null;
  const [row] = await db
    .delete(verificationTokens)
    .where(and(eq(verificationTokens.token, sha256(code)), sql`${verificationTokens.identifier} like ${`${HANDOFF_PREFIX}%`}`))
    .returning();
  if (!row || row.expires <= now) return null;
  return row.identifier.slice(HANDOFF_PREFIX.length);
}

/* ---------- Email: the magic link, opened in the app ---------- */

/**
 * Redeems a magic link's token the way Auth.js's email callback does: the stored token is
 * sha256(token + secret), deleted on use, and must not be expired. Signs in to the account with that
 * email, or creates it, marking the email verified. Returns null for an unknown, used or expired link.
 */
export async function redeemEmailToken(
  db: Db,
  { email, token, secret }: { email: string; token: string; secret: string },
  now = new Date(),
): Promise<{ userId: string; isNew: boolean } | null> {
  const identifier = email.trim().toLowerCase();
  if (!identifier || !token) return null;
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .delete(verificationTokens)
      .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, sha256(`${token}${secret}`))))
      .returning();
    if (!invite || invite.expires <= now) return null;
    return userForEmail(tx, identifier, now);
  });
}

/** The account with this (lowercased) email, or a new one, with the email marked verified: its owner just proved it. */
export async function userForEmail(db: Db, email: string, now = new Date()): Promise<{ userId: string; isNew: boolean }> {
  const [existing] = await db.select({ id: users.id, emailVerified: users.emailVerified }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    if (!existing.emailVerified) await db.update(users).set({ emailVerified: now }).where(eq(users.id, existing.id));
    return { userId: existing.id, isNew: false };
  }
  const [created] = await db.insert(users).values({ email, emailVerified: now }).returning({ id: users.id });
  return { userId: created.id, isNew: true };
}

/** Compares two secrets in constant time. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
