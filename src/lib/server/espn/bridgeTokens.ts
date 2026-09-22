import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { espnBridgeTokens, leagues, users } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/**
 * Pairing tokens for the ESPN draft bridge. The pairing popup (first-party, signed in) mints one and
 * hands it to the bridge in the user's ESPN tab, which sends it as a Bearer token on every relay
 * request: cross-site requests from espn.com don't carry our session cookie.
 *
 * A token only lets its holder post draft frames for one war room league and one ESPN league, and
 * it expires after a draft's worth of time. Only its SHA-256 is stored.
 */

/** Long enough for a draft that starts late and runs long; short enough that a leaked token soon dies. */
export const BRIDGE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface BridgeScope {
  userId: string;
  leagueId: string;
  espnLeagueId: string;
  espnTeamId: number;
  season: number;
}

export interface VerifiedBridge extends BridgeScope {
  email: string | null;
  expiresAt: Date;
}

/** Mints a token for this scope. The caller has already checked the league is the user's and they may use the bridge. */
export async function mintBridgeToken(db: Db, scope: BridgeScope, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + BRIDGE_TOKEN_TTL_MS);
  await db.insert(espnBridgeTokens).values({ tokenHash: hash(token), ...scope, createdAt: now, expiresAt });
  return { token, expiresAt };
}

/** The token's scope, or null if it's unknown, expired, or its league has been deleted. */
export async function verifyBridgeToken(db: Db, token: string, now = new Date()): Promise<VerifiedBridge | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      userId: espnBridgeTokens.userId,
      leagueId: espnBridgeTokens.leagueId,
      espnLeagueId: espnBridgeTokens.espnLeagueId,
      espnTeamId: espnBridgeTokens.espnTeamId,
      season: espnBridgeTokens.season,
      expiresAt: espnBridgeTokens.expiresAt,
      email: users.email,
    })
    .from(espnBridgeTokens)
    .innerJoin(leagues, and(eq(leagues.id, espnBridgeTokens.leagueId), eq(leagues.userId, espnBridgeTokens.userId)))
    .innerJoin(users, eq(users.id, espnBridgeTokens.userId))
    .where(and(eq(espnBridgeTokens.tokenHash, hash(token)), gt(espnBridgeTokens.expiresAt, now), isNull(leagues.deletedAt)));
  return row ?? null;
}

/** Revokes every token for a league, e.g. when the user disconnects it. Returns how many were revoked. */
export async function revokeBridgeTokens(db: Db, userId: string, leagueId: string): Promise<number> {
  const deleted = await db
    .delete(espnBridgeTokens)
    .where(and(eq(espnBridgeTokens.userId, userId), eq(espnBridgeTokens.leagueId, leagueId)))
    .returning({ tokenHash: espnBridgeTokens.tokenHash });
  return deleted.length;
}

/**
 * Expired tokens are kept this long before they're deleted. They authenticate nothing once expired,
 * but they remember which league an ESPN league was paired with (see lastPairedLeague()).
 */
export const EXPIRED_TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Deletes tokens past their retention. Cheap; called when minting so the table never accumulates. */
export async function purgeExpiredBridgeTokens(db: Db, now = new Date()): Promise<void> {
  await db.delete(espnBridgeTokens).where(lt(espnBridgeTokens.expiresAt, new Date(now.getTime() - EXPIRED_TOKEN_RETENTION_MS)));
}

/** The war room league this user last paired with an ESPN league, expired or not, so pairing again can preselect it. */
export async function lastPairedLeague(db: Db, userId: string, espnLeagueId: string): Promise<string | null> {
  const [row] = await db
    .select({ leagueId: espnBridgeTokens.leagueId })
    .from(espnBridgeTokens)
    .innerJoin(leagues, eq(leagues.id, espnBridgeTokens.leagueId))
    .where(and(eq(espnBridgeTokens.userId, userId), eq(espnBridgeTokens.espnLeagueId, espnLeagueId), isNull(leagues.deletedAt)))
    .orderBy(desc(espnBridgeTokens.createdAt))
    .limit(1);
  return row?.leagueId ?? null;
}
