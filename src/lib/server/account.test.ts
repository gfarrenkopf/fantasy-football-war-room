import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import {
  accounts,
  aiGenerations,
  deletedAccountPurchases,
  drafts,
  entitlements,
  espnDisclosureAcks,
  leagues,
  seasonEmails,
  sessions,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { DraftState } from "@/lib/draft/types";
import { deleteAccount } from "./account";
import { createAppSession, createHandoffCode } from "./appAuth";
import { grantEntitlement, SEASON_PASS } from "./entitlements";
import { storeLogin } from "./espn/logins";
import { createTestLeague } from "./testLeagues";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const key = Buffer.alloc(32, 9);

/** A user with something in every table that holds user data. */
async function seed(email: string) {
  const userId = await createTestUser(db, email);
  const leagueId = await createTestLeague(db, userId);
  const deletedLeagueId = await createTestLeague(db, userId, "Old league");
  await db.update(leagues).set({ deletedAt: new Date() }).where(eq(leagues.id, deletedLeagueId));
  await db.insert(drafts).values({ leagueId, state: { picks: [] } as unknown as DraftState });
  const source = `cs_${crypto.randomUUID()}`;
  await grantEntitlement(db, { leagueId, userId, kind: SEASON_PASS, source, amountTotal: 999, currency: "usd" });
  await storeLogin(db, key, userId, { espnS2: "s2", swid: "{SWID}" }, { season: 2026, consentVersion: 3 });
  await db.insert(accounts).values({ userId, type: "oidc", provider: "apple", providerAccountId: `apple-${userId}` });
  await createAppSession(db, userId);
  await createHandoffCode(db, userId);
  await db.insert(verificationTokens).values({ identifier: email, token: `t-${userId}`, expires: new Date(Date.now() + 60_000) });
  await db.insert(espnDisclosureAcks).values({ userId, version: 3 });
  await db.insert(seasonEmails).values({ userId, kind: "lineup", sentOn: "2026-10-11" });
  await db.insert(aiGenerations).values({ leagueId, userId, jobId: "j", provider: "anthropic", model: "m", promptVersion: 1, outcome: "ready", durationMs: 1 });
  return { userId, leagueId, source };
}

/** Rows that mention a user, in every table with a user_id column, so a table added later is covered too. */
async function rowsFor(userId: string): Promise<Record<string, number>> {
  // Db is driver-agnostic, so execute() is untyped; on PGlite it returns { rows }.
  const query = async <T,>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
  const tables = await query<{ table_name: string }>(
    sql`select table_name from information_schema.columns where column_name = 'user_id' and table_schema = 'public' order by table_name`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await query<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table_name)} where user_id = ${userId}`);
    counts[table_name] = row.n;
  }
  return counts;
}

describe("deleteAccount", () => {
  it("removes every row the user owns, keeps the purchase unlinked, and leaves other users alone", async () => {
    const gone = await seed("gone@example.test");
    const kept = await seed("kept@example.test");
    const keptBefore = await rowsFor(kept.userId);
    expect(Object.values(await rowsFor(gone.userId)).some((n) => n > 0)).toBe(true);

    expect(await deleteAccount(db, gone.userId)).toBe(true);

    const after = await rowsFor(gone.userId);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(await db.select().from(users).where(eq(users.id, gone.userId))).toEqual([]);
    expect(await db.select().from(drafts).where(eq(drafts.leagueId, gone.leagueId))).toEqual([]);
    expect(await db.select().from(entitlements).where(eq(entitlements.leagueId, gone.leagueId))).toEqual([]);
    expect(await db.select().from(verificationTokens).where(eq(verificationTokens.identifier, "gone@example.test"))).toEqual([]);
    expect(await db.select().from(verificationTokens).where(eq(verificationTokens.identifier, `app-handoff:${gone.userId}`))).toEqual([]);
    expect(await db.select().from(sessions).where(eq(sessions.userId, gone.userId))).toEqual([]);

    const [purchase] = await db.select().from(deletedAccountPurchases).where(eq(deletedAccountPurchases.source, gone.source));
    expect(purchase).toMatchObject({ kind: SEASON_PASS, amountTotal: 999, currency: "usd" });
    expect(Object.keys(purchase)).not.toContain("userId");
    expect(await db.select().from(aiGenerations).where(eq(aiGenerations.userId, "deleted"))).toHaveLength(1);

    expect(await rowsFor(kept.userId)).toEqual(keptBefore);
    expect(await db.select().from(entitlements).where(eq(entitlements.leagueId, kept.leagueId))).toHaveLength(1);
    expect(await db.select().from(deletedAccountPurchases).where(eq(deletedAccountPurchases.source, kept.source))).toEqual([]);
  });

  it("is false for an unknown user", async () => {
    expect(await deleteAccount(db, "nobody")).toBe(false);
  });
});
