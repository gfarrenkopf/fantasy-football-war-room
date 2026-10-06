import { createHash, randomBytes } from "node:crypto";
import { count, eq, lt } from "drizzle-orm";
import { espnLoginClaims } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import type { EspnLogin } from "./logins";
import { open, seal } from "./secretBox";

/**
 * One-time claims carrying an ESPN login from the bridge to a War Room account (APE-297). The
 * bridge runs on ESPN's site, where the user's War Room session doesn't reach, and on a phone it
 * can't count on a popup talking back to the ESPN tab. So it posts the login here, gets a claim code,
 * and opens War Room in the same tab with it; the signed-in user claims it there.
 *
 * Anyone can create a claim, so a claim is worth nothing on its own: it only becomes a stored login
 * when a signed-in user takes it, and then it's that user's own login (connectSeason() checks ESPN
 * accepts it and that they own a team). Claims expire in minutes and the table is capped.
 */

/** Long enough to sign in from a magic link on a phone; short enough that a leaked code soon dies. */
export const CLAIM_TTL_MS = 15 * 60 * 1000;
/** Live claims allowed at once, so the open endpoint can't fill the table. Far above real use. */
export const MAX_LIVE_CLAIMS = 2000;

const hash = (code: string) => createHash("sha256").update(code).digest("hex");
/** Bound into the seal, so a sealed value only opens under its own code. */
const context = (tokenHash: string) => `espn-claim:${tokenHash}`;

export interface ClaimScope {
  espnLeagueId: string;
  season: number;
  /** The consent version the user agreed to in the bridge overlay. */
  consentVersion: number;
}

export interface Claim extends ClaimScope {
  login: EspnLogin;
}

/** Stores the login under a fresh claim code and returns the code, or null when too many claims are live. */
export async function createClaim(db: Db, key: Buffer, login: EspnLogin, scope: ClaimScope, now = new Date()): Promise<string | null> {
  await purgeExpiredClaims(db, now);
  const [{ live }] = await db.select({ live: count() }).from(espnLoginClaims);
  if (live >= MAX_LIVE_CLAIMS) return null;
  const code = randomBytes(32).toString("base64url");
  const tokenHash = hash(code);
  await db.insert(espnLoginClaims).values({
    tokenHash,
    sealed: seal(JSON.stringify({ espnS2: login.espnS2, swid: login.swid }), key, context(tokenHash)),
    ...scope,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
  });
  return code;
}

/** What a claim is for, without opening or using it, so the page can say which league it connects. */
export async function peekClaim(db: Db, code: string, now = new Date()): Promise<ClaimScope | null> {
  if (!code) return null;
  const [row] = await db
    .select({ espnLeagueId: espnLoginClaims.espnLeagueId, season: espnLoginClaims.season, consentVersion: espnLoginClaims.consentVersion, expiresAt: espnLoginClaims.expiresAt })
    .from(espnLoginClaims)
    .where(eq(espnLoginClaims.tokenHash, hash(code)));
  if (!row || row.expiresAt <= now) return null;
  return { espnLeagueId: row.espnLeagueId, season: row.season, consentVersion: row.consentVersion };
}

/** The claim's login, left in place. Null if unknown, expired or unopenable. */
export async function openClaim(db: Db, key: Buffer, code: string, now = new Date()): Promise<Claim | null> {
  if (!code) return null;
  const tokenHash = hash(code);
  const [row] = await db.select().from(espnLoginClaims).where(eq(espnLoginClaims.tokenHash, tokenHash));
  if (!row || row.expiresAt <= now) return null;
  const plain = open(row.sealed, key, context(tokenHash));
  if (!plain) return null;
  const { espnS2, swid } = JSON.parse(plain) as EspnLogin;
  return { espnLeagueId: row.espnLeagueId, season: row.season, consentVersion: row.consentVersion, login: { espnS2, swid } };
}

/** Uses the claim up. */
export async function dropClaim(db: Db, code: string): Promise<void> {
  await db.delete(espnLoginClaims).where(eq(espnLoginClaims.tokenHash, hash(code)));
}

/** Deletes expired claims. Cheap; called when creating one so the table never accumulates. */
export async function purgeExpiredClaims(db: Db, now = new Date()): Promise<void> {
  await db.delete(espnLoginClaims).where(lt(espnLoginClaims.expiresAt, now));
}

