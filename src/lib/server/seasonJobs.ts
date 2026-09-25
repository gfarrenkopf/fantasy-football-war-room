import { and, eq, isNull } from "drizzle-orm";
import { espnSeasonLinks, leagues, seasonEmails, users, type SeasonEmailKind } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import type { SeasonEmail } from "@/lib/season/email";
import { unsubscribeToken, wantsSeasonEmails } from "./seasonPrefs";

/** What the season jobs share (the Sunday AI lineup, 11.3, and the early-kickoff alert, 11.4). */

/** Leagues nobody has opened for this long are skipped. Opening the page re-enrols them. */
export const INACTIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export interface JobLeague {
  userId: string;
  email: string | null;
  leagueId: string;
  name: string;
  leagueSeason: number;
}

/** Connected leagues opened in the last two weeks, by user, and how many were left out as idle. */
export async function activeLeagues(db: Db, now: Date): Promise<{ total: number; inactive: number; byUser: Map<string, JobLeague[]> }> {
  const rows = await db
    .select({
      userId: espnSeasonLinks.userId,
      email: users.email,
      leagueId: espnSeasonLinks.leagueId,
      name: leagues.name,
      leagueSeason: leagues.season,
      lastViewedAt: espnSeasonLinks.lastViewedAt,
    })
    .from(espnSeasonLinks)
    .innerJoin(leagues, and(eq(leagues.id, espnSeasonLinks.leagueId), eq(leagues.userId, espnSeasonLinks.userId), isNull(leagues.deletedAt)))
    .innerJoin(users, eq(users.id, espnSeasonLinks.userId))
    .orderBy(espnSeasonLinks.userId, espnSeasonLinks.createdAt);
  const byUser = new Map<string, JobLeague[]>();
  let inactive = 0;
  for (const { lastViewedAt, ...league } of rows) {
    if (!lastViewedAt || now.getTime() - lastViewedAt.getTime() > INACTIVE_AFTER_MS) {
      inactive++;
      continue;
    }
    byUser.set(league.userId, [...(byUser.get(league.userId) ?? []), league]);
  }
  return { total: rows.length, inactive, byUser };
}

export interface JobMail {
  /** Sends one email, or null when email isn't configured. */
  sendEmail: ((to: string, email: SeasonEmail, headers: Record<string, string>) => Promise<void>) | null;
  /** The public origin, for links in emails. */
  baseUrl: string;
  /** Signs unsubscribe links. */
  secret: string;
}

/** The link at the bottom of every season email: a page with a button, so a mail scanner opening it changes nothing. */
export function unsubscribeUrl(mail: JobMail, userId: string): string {
  const url = new URL("/season/unsubscribe", mail.baseUrl);
  url.searchParams.set("u", userId);
  url.searchParams.set("t", unsubscribeToken(mail.secret, userId));
  return url.toString();
}

/** One [server-error] line for a job, which the alert emails pick up. */
export function jobError(job: string, message: string, detail: Record<string, unknown>): void {
  console.error(`[server-error] ${JSON.stringify({ method: "JOB", path: `/api/internal/season/${job}`, route: `season-${job}`, message, ...detail })}`);
}

/**
 * Sends `email` unless the user opted out or already got this one: one per user, kind, day and slot.
 * The row is claimed before sending and released if sending fails, so a rerun tries again.
 */
export async function sendOnce(
  db: Db,
  mail: JobMail,
  { job, userId, to, kind, slot = "", now }: { job: string; userId: string; to: string; kind: SeasonEmailKind; slot?: string; now: Date },
  email: SeasonEmail,
): Promise<boolean> {
  if (!mail.sendEmail || !(await wantsSeasonEmails(db, userId))) return false;
  const sentOn = now.toISOString().slice(0, 10);
  const claimed = await db.insert(seasonEmails).values({ userId, kind, sentOn, slot, sentAt: now }).onConflictDoNothing().returning({ kind: seasonEmails.kind });
  if (!claimed.length) return false;
  const oneClick = unsubscribeUrl(mail, userId).replace("/season/unsubscribe", "/api/season/unsubscribe");
  try {
    await mail.sendEmail(to, email, { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    return true;
  } catch (error) {
    await db.delete(seasonEmails).where(and(eq(seasonEmails.userId, userId), eq(seasonEmails.kind, kind), eq(seasonEmails.sentOn, sentOn), eq(seasonEmails.slot, slot)));
    jobError(job, `couldn't send the ${kind} email: ${(error as Error).message}`, { userId });
    return false;
  }
}
