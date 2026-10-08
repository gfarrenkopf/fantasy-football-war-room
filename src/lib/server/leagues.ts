import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { drafts, leagues } from "@/lib/db/schema";
import { leagueChanged } from "@/lib/draft/league";
import type { DraftState, LeagueSettings } from "@/lib/draft/types";
import type { EspnConnection, LeagueRecord } from "@/lib/storage/types";

/**
 * League and draft persistence for signed-in users. Every function takes the session user's id
 * and only ever reads or writes that user's rows: a league owned by someone else, or deleted,
 * is indistinguishable from one that doesn't exist.
 *
 * Inputs are expected to be validated already (parseLeagueRecord / migrateDraftState).
 */

/** Leagues per account. Generous for real use; stops a script from filling the database. */
export const MAX_LEAGUES_PER_USER = 100;

type LeagueRow = typeof leagues.$inferSelect;

const toRecord = (row: LeagueRow): LeagueRecord => ({
  id: row.id,
  name: row.name,
  season: row.season,
  datasetId: row.datasetId,
  settings: row.settings,
  ...(row.draftAt ? { draftAt: row.draftAt } : {}),
  ...(row.espn ? { espn: row.espn } : {}),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const owned = (userId: string, leagueId: string) => and(eq(leagues.id, leagueId), eq(leagues.userId, userId), isNull(leagues.deletedAt));

/** The user's live league row, or null if it doesn't exist, is deleted, or belongs to someone else. */
export async function findLeague(db: Db, userId: string, leagueId: string): Promise<LeagueRow | null> {
  const [row] = await db.select().from(leagues).where(owned(userId, leagueId));
  return row ?? null;
}

/** The user's leagues, oldest first. */
export async function listLeagues(db: Db, userId: string): Promise<LeagueRecord[]> {
  const rows = await db
    .select()
    .from(leagues)
    .where(and(eq(leagues.userId, userId), isNull(leagues.deletedAt)))
    .orderBy(leagues.createdAt, leagues.id);
  return rows.map(toRecord);
}

export type UpsertLeagueResult =
  /** Saved; or kept the stored league because it was edited more recently (`applied: false`). */
  | { status: "ok"; league: LeagueRecord; applied: boolean }
  /** The id belongs to another user or a deleted league. */
  | { status: "not-found" }
  | { status: "limit" };

/**
 * Creates or updates a league. Last write wins by `updatedAt`: an edit older than the stored
 * one (e.g. queued offline on another device) is not applied, and the stored league is returned.
 */
export async function upsertLeague(db: Db, userId: string, record: LeagueRecord): Promise<UpsertLeagueResult> {
  const values = {
    id: record.id,
    userId,
    name: record.name,
    season: record.season,
    datasetId: record.datasetId,
    settings: record.settings,
    draftAt: record.draftAt ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };

  const existing = await db.select({ userId: leagues.userId, deletedAt: leagues.deletedAt }).from(leagues).where(eq(leagues.id, record.id));
  if (existing.length === 0) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(leagues)
      .where(and(eq(leagues.userId, userId), isNull(leagues.deletedAt)));
    if (n >= MAX_LEAGUES_PER_USER) return { status: "limit" };
  } else if (existing[0].userId !== userId || existing[0].deletedAt) {
    return { status: "not-found" };
  }

  const [saved] = await db
    .insert(leagues)
    .values(values)
    .onConflictDoUpdate({
      target: leagues.id,
      set: {
        // A connected league's name is ESPN's too (APE-325).
        name: sql`case when ${leagues.espn} is null then excluded.name else ${leagues.name} end`,
        season: values.season,
        datasetId: values.datasetId,
        // A league connected to ESPN takes its settings from ESPN: a client only sets what ESPN
        // doesn't have, the Value/Reach threshold (APE-325). `espn` itself is never a client's to set.
        settings: sql`case when ${leagues.espn} is null then excluded.settings else jsonb_set(${leagues.settings}, '{valueThreshold}', excluded.settings->'valueThreshold') end`,
        // Only when the edit carries it: a record from an older client, which doesn't know the
        // field, must not wipe a draft date set elsewhere.
        ...("draftAt" in record ? { draftAt: values.draftAt } : {}),
        updatedAt: values.updatedAt,
      },
      // Only the owner's live league, and only with a newer (or equal) edit.
      setWhere: sql`${leagues.userId} = ${userId} and ${leagues.deletedAt} is null and ${leagues.updatedAt} <= excluded.updated_at`,
    })
    .returning();
  if (saved) return { status: "ok", league: toRecord(saved), applied: true };

  const current = await findLeague(db, userId, record.id);
  return current ? { status: "ok", league: toRecord(current), applied: false } : { status: "not-found" };
}

/**
 * Connects a league to an ESPN draft (APE-325): live draft sync pairing it, or connecting its
 * season. With ESPN's `settings` (as `toLeagueSettings()` reads them) the league takes them,
 * keeping its own Value/Reach threshold, and with ESPN's `name` it takes that. Bumps `updatedAt`
 * so every device's copy is replaced. False if the user has no such league.
 */
export async function connectEspn(
  db: Db,
  userId: string,
  leagueId: string,
  espn: EspnConnection,
  { settings, name }: { settings?: Omit<LeagueSettings, "valueThreshold">; name?: string } = {},
  now = new Date(),
): Promise<boolean> {
  const row = await findLeague(db, userId, leagueId);
  if (!row) return false;
  const next = settings ? { ...settings, valueThreshold: row.settings.valueThreshold } : row.settings;
  const nextName = name ?? row.name;
  const sameEspn = row.espn?.espnLeagueId === espn.espnLeagueId && row.espn.espnTeamId === espn.espnTeamId && row.espn.season === espn.season;
  if (sameEspn && !leagueChanged(row.settings, next) && nextName === row.name) return true;
  const updatedAt = new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1));
  await db
    .update(leagues)
    .set({ espn: { espnLeagueId: espn.espnLeagueId, espnTeamId: espn.espnTeamId, season: espn.season }, settings: next, name: nextName, updatedAt })
    .where(owned(userId, leagueId));
  return true;
}

/** Soft-deletes a league. Returns false if the user has no such league. */
export async function deleteLeague(db: Db, userId: string, leagueId: string): Promise<boolean> {
  const rows = await db.update(leagues).set({ deletedAt: new Date() }).where(owned(userId, leagueId)).returning({ id: leagues.id });
  return rows.length > 0;
}

export interface StoredDraft {
  /** Null when nothing has been saved for the league yet. */
  state: DraftState | null;
  /** 0 before the first save; increases by one on every save. */
  revision: number;
}

/** The league's draft, or null if the user has no such league. */
export async function getDraft(db: Db, userId: string, leagueId: string): Promise<StoredDraft | null> {
  if (!(await findLeague(db, userId, leagueId))) return null;
  const [row] = await db.select({ state: drafts.state, revision: drafts.revision }).from(drafts).where(eq(drafts.leagueId, leagueId));
  return row ?? { state: null, revision: 0 };
}

export type PutDraftResult =
  | { status: "ok"; revision: number }
  /** `baseRevision` is stale: someone saved since. Carries what's stored now. */
  | { status: "conflict"; current: StoredDraft }
  | { status: "not-found" };

/**
 * Saves a draft if `baseRevision` is the stored revision (optimistic concurrency).
 * The compare-and-set is a single statement, so two concurrent saves can't both succeed.
 */
export async function putDraft(db: Db, userId: string, leagueId: string, state: DraftState, baseRevision: number): Promise<PutDraftResult> {
  if (!(await findLeague(db, userId, leagueId))) return { status: "not-found" };

  const [updated] =
    baseRevision === 0
      ? await db
          .insert(drafts)
          .values({ leagueId, state, revision: 1, updatedAt: new Date() })
          .onConflictDoNothing({ target: drafts.leagueId })
          .returning({ revision: drafts.revision })
      : await db
          .update(drafts)
          .set({ state, revision: sql`${drafts.revision} + 1`, updatedAt: new Date() })
          .where(and(eq(drafts.leagueId, leagueId), eq(drafts.revision, baseRevision)))
          .returning({ revision: drafts.revision });
  if (updated) return { status: "ok", revision: updated.revision };

  const current = await getDraft(db, userId, leagueId);
  return current ? { status: "conflict", current } : { status: "not-found" };
}
