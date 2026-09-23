import { and, eq, gt, lt } from "drizzle-orm";
import { espnServerClients, type EspnServerClientState } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import type { BridgeScope } from "./bridgeTokens";
import { open, seal } from "./secretBox";

/**
 * The ESPN join credential a user handed War Room (9.1), so a server-side client can join their
 * draft room without their ESPN tab (9.2). One row per war room league, sealed with ESPN_CODE_KEY.
 *
 * The code is a credential: nothing here logs it, and nothing returns it except `loadCredential`,
 * which only the server-side client calls.
 */

/** A draft room opens about an hour ahead and a slow draft runs a few hours; nothing outlives this. */
export const CREDENTIAL_TTL_MS = 12 * 60 * 60 * 1000;

export interface EspnCredential {
  /** The draft room's join code: a signed integer, as a string (it can be negative). */
  code: string;
  /** The user's ESPN member id, `{GUID}`. */
  swid: string;
}

export interface StoredCredential extends EspnCredential {
  scope: BridgeScope;
  leagueSettings: unknown;
  pickTeams: number[] | null;
  state: EspnServerClientState;
  expiresAt: Date;
}

/** Bound into the seal, so a sealed value only opens on the row it was written for. */
const context = (s: BridgeScope) => `espn-code:${s.userId}:${s.leagueId}:${s.espnLeagueId}:${s.espnTeamId}:${s.season}`;

/**
 * Stores (or replaces) the credential for a league. A fresh handover for the same ESPN draft keeps
 * the client's state, so re-running the bookmarklet mid-draft doesn't drop a take-over; a different
 * draft starts over at `stored`.
 */
export async function storeCredential(
  db: Db,
  key: Buffer,
  scope: BridgeScope,
  credential: EspnCredential,
  extras: { leagueSettings?: unknown; pickTeams?: number[] | null; consentVersion: number },
  now = new Date(),
): Promise<void> {
  const sealed = seal(JSON.stringify({ code: credential.code, swid: credential.swid }), key, context(scope));
  const values = {
    ...scope,
    sealed,
    leagueSettings: extras.leagueSettings ?? null,
    pickTeams: extras.pickTeams ?? null,
    consentVersion: extras.consentVersion,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + CREDENTIAL_TTL_MS),
  };
  const [existing] = await db.select().from(espnServerClients).where(eq(espnServerClients.leagueId, scope.leagueId));
  const sameDraft =
    existing &&
    existing.userId === scope.userId &&
    existing.espnLeagueId === scope.espnLeagueId &&
    existing.espnTeamId === scope.espnTeamId &&
    existing.season === scope.season;
  await db
    .insert(espnServerClients)
    .values({ ...values, state: "stored", createdAt: now })
    .onConflictDoUpdate({ target: espnServerClients.leagueId, set: { ...values, ...(sameDraft ? {} : { state: "stored", createdAt: now }) } });
}

/** The credential for a league, or null if there's none, it has expired, or it won't open under this key. */
export async function loadCredential(db: Db, key: Buffer, userId: string, leagueId: string, now = new Date()): Promise<StoredCredential | null> {
  const [row] = await db
    .select()
    .from(espnServerClients)
    .where(and(eq(espnServerClients.leagueId, leagueId), eq(espnServerClients.userId, userId)));
  if (!row || row.expiresAt <= now) return null;
  const scope: BridgeScope = { userId: row.userId, leagueId: row.leagueId, espnLeagueId: row.espnLeagueId, espnTeamId: row.espnTeamId, season: row.season };
  const plain = open(row.sealed, key, context(scope));
  if (!plain) return null;
  const { code, swid } = JSON.parse(plain) as EspnCredential;
  return { scope, code, swid, leagueSettings: row.leagueSettings, pickTeams: row.pickTeams ?? null, state: row.state, expiresAt: row.expiresAt };
}

/** Whether a league has a live credential, without opening it. */
export async function hasCredential(db: Db, userId: string, leagueId: string, now = new Date()): Promise<{ state: EspnServerClientState } | null> {
  const [row] = await db
    .select({ state: espnServerClients.state, expiresAt: espnServerClients.expiresAt })
    .from(espnServerClients)
    .where(and(eq(espnServerClients.leagueId, leagueId), eq(espnServerClients.userId, userId)));
  return row && row.expiresAt > now ? { state: row.state } : null;
}

export async function setServerClientState(db: Db, userId: string, leagueId: string, state: EspnServerClientState, now = new Date()): Promise<void> {
  await db
    .update(espnServerClients)
    .set({ state, updatedAt: now })
    .where(and(eq(espnServerClients.leagueId, leagueId), eq(espnServerClients.userId, userId)));
}

/** Forgets a league's credential: the draft completed, or the user withdrew it. Returns whether there was one. */
export async function deleteCredential(db: Db, userId: string, leagueId: string): Promise<boolean> {
  const deleted = await db
    .delete(espnServerClients)
    .where(and(eq(espnServerClients.leagueId, leagueId), eq(espnServerClients.userId, userId)))
    .returning({ leagueId: espnServerClients.leagueId });
  return deleted.length > 0;
}

/** Drafts a server-side client was holding, unexpired: what a restarted process rejoins (9.5). */
export async function listHolding(db: Db, now = new Date()): Promise<{ userId: string; leagueId: string }[]> {
  return db
    .select({ userId: espnServerClients.userId, leagueId: espnServerClients.leagueId })
    .from(espnServerClients)
    .where(and(eq(espnServerClients.state, "holding"), gt(espnServerClients.expiresAt, now)));
}

/** Deletes credentials past their expiry, for drafts that never reached completion. */
export async function purgeExpiredCredentials(db: Db, now = new Date()): Promise<void> {
  await db.delete(espnServerClients).where(lt(espnServerClients.expiresAt, now));
}
