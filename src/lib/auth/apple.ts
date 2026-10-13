import { createPrivateKey, sign } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * Sign in with Apple helpers shared by the web provider (src/lib/auth/index.ts) and the app's
 * token exchange. No Auth.js or config imports, so they're unit-testable.
 */

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** Apple caps a client secret's lifetime at six months; a day keeps a leaked one short-lived. */
const SECRET_TTL_SECONDS = 24 * 60 * 60;

/**
 * The client secret Apple's token endpoint wants: a JWT signed with the Sign in with Apple key
 * (ES256), naming the team as issuer and the Services ID as subject.
 * https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
 */
export function appleClientSecret(
  opts: { teamId: string; keyId: string; clientId: string; privateKey: string },
  now = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: opts.keyId }));
  const claims = b64url(
    JSON.stringify({ iss: opts.teamId, iat: now, exp: now + SECRET_TTL_SECONDS, aud: "https://appleid.apple.com", sub: opts.clientId }),
  );
  const input = `${header}.${claims}`;
  // JWS wants the raw r||s signature, not DER.
  const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey(opts.privateKey), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

/**
 * Builds a client secret per call, but reuses it for an hour: Auth.js builds its config per
 * request, and signing on every page load would be wasted work.
 */
export function cachedAppleClientSecret(opts: Parameters<typeof appleClientSecret>[0]): string {
  const now = Math.floor(Date.now() / 1000);
  if (!cache || cache.keyId !== opts.keyId || cache.clientId !== opts.clientId || now - cache.at > 60 * 60) {
    cache = { keyId: opts.keyId, clientId: opts.clientId, at: now, secret: appleClientSecret(opts, now) };
  }
  return cache.secret;
}
let cache: { keyId: string; clientId: string; at: number; secret: string } | undefined;

/** Apple's first-consent `user` parameter (web) or `fullName` (app), joined; null when absent. */
export function appleDisplayName(name: { firstName?: string | null; lastName?: string | null } | null | undefined): string | null {
  const joined = [name?.firstName, name?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return joined ? joined.slice(0, 200) : null;
}

/**
 * Apple sends the user's name only the first time they consent. A new account gets it at
 * creation; an existing account (linked by email) gets it here, unless it already has one.
 */
export async function storeAppleName(db: Db, userId: string, name: string | null): Promise<void> {
  if (!name) return;
  await db
    .update(users)
    .set({ name })
    .where(and(eq(users.id, userId), isNull(users.name)));
}
