import { eq, inArray, or } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { aiGenerations, deletedAccountPurchases, entitlements, leagues, users, verificationTokens } from "@/lib/db/schema";
import { deleteLogin } from "./espn/logins";

/**
 * Deletes an account and everything it owns, in one transaction (APE-374; App Store guideline
 * 5.1.1(v) and the web's account menu).
 *
 * Most of it goes by ON DELETE CASCADE from `users`: sessions and linked sign-ins, leagues (and,
 * through them, drafts, entitlements, AI plans and every season table), ESPN bridge tokens,
 * disclosure acks, server clients, the ESPN login, season links, AI trials, prefs and sent-email
 * records. The rest is done here:
 * - purchases are copied to `deleted_account_purchases` first, without user or league, for tax and
 *   refunds (docs/payments.md);
 * - AI usage records (`ai_generations`, no foreign key so cost history survives) lose their user id;
 * - pending sign-in links and app hand-off codes, keyed by email or user id, are deleted;
 * - the ESPN login is deleted explicitly through deleteLogin(), the one place logins are removed.
 *
 * TODO(Epic 21): device tokens. Give the table an ON DELETE CASCADE foreign key to users.id and
 * nothing here has to change; the deletion test seeds every user-owned table and will catch it.
 *
 * Returns false when there was no such user.
 */
export async function deleteAccount(db: Db, userId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!user) return false;

    const owned = tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.userId, userId));
    const purchases = await tx.select().from(entitlements).where(inArray(entitlements.leagueId, owned));
    if (purchases.length) {
      await tx
        .insert(deletedAccountPurchases)
        .values(purchases.map((p) => ({ source: p.source, kind: p.kind, amountTotal: p.amountTotal, currency: p.currency, grantedAt: p.grantedAt, deletedAt: now })))
        .onConflictDoNothing();
    }

    await tx.update(aiGenerations).set({ userId: "deleted" }).where(eq(aiGenerations.userId, userId));
    await tx
      .delete(verificationTokens)
      .where(
        user.email
          ? or(eq(verificationTokens.identifier, user.email), eq(verificationTokens.identifier, `app-handoff:${userId}`))
          : eq(verificationTokens.identifier, `app-handoff:${userId}`),
      );
    await deleteLogin(tx, userId);
    await tx.delete(users).where(eq(users.id, userId));
    return true;
  });
}
