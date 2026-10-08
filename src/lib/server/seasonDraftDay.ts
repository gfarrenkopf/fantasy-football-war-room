import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { drafts, espnBridgeTokens, espnSeasonLinks, leagues, users } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { espnDraftPage, espnSetup } from "@/lib/espn/pages";
import { draftTimeLabel, renderDraftDayEmail } from "@/lib/season/email";
import { sendOnce, unsubscribeUrl, type JobMail } from "./seasonJobs";

/**
 * The draft-day reminder (APE-336). A user who connected their ESPN season before the draft still
 * has to tap the bookmark inside ESPN's draft room for live sync, since the draft's picks can only
 * be read there, and ESPN opens that room only an hour before the draft. A timer runs this every 15
 * minutes; it emails about drafts 45-60 minutes away, so each draft falls in exactly one run.
 *
 * Skipped: a draft already connected (a pairing token that hasn't expired), one already under way
 * or final, and a draft time without a time of day. Reruns are safe: one email per user and draft
 * time. The in-app banner says the same thing to anyone with Draft Room open (EspnDraftDay).
 */

/** How far ahead of the draft the email goes: when ESPN opens the draft room. */
export const DRAFT_ROOM_OPENS_MS = 60 * 60 * 1000;
/** The timer's interval: the window each run covers. */
export const RUN_EVERY_MS = 15 * 60 * 1000;

export interface DraftDaySummary {
  dryRun: boolean;
  /** Connected leagues drafting in this run's window. */
  drafts: number;
  /** Of those, already connected or under way. */
  connected: number;
  emails: number;
}

export async function runDraftDayJob(db: Db, deps: JobMail & { now?: Date }, { dryRun = false }: { dryRun?: boolean } = {}): Promise<DraftDaySummary> {
  const now = deps.now ?? new Date();
  const summary: DraftDaySummary = { dryRun, drafts: 0, connected: 0, emails: 0 };
  const from = now.getTime() + DRAFT_ROOM_OPENS_MS - RUN_EVERY_MS;
  const to = now.getTime() + DRAFT_ROOM_OPENS_MS;

  const rows = await db
    .select({
      userId: espnSeasonLinks.userId,
      email: users.email,
      leagueId: leagues.id,
      name: leagues.name,
      draftAt: leagues.draftAt,
      espnLeagueId: espnSeasonLinks.espnLeagueId,
      espnTeamId: espnSeasonLinks.espnTeamId,
      season: espnSeasonLinks.season,
    })
    .from(espnSeasonLinks)
    .innerJoin(leagues, and(eq(leagues.id, espnSeasonLinks.leagueId), eq(leagues.userId, espnSeasonLinks.userId), isNull(leagues.deletedAt)))
    .innerJoin(users, eq(users.id, espnSeasonLinks.userId))
    .where(isNotNull(leagues.draftAt));
  // Only a draft time with a time of day; a bare date ("2026-08-30") says nothing about when the room opens.
  const due = rows.flatMap((r) => {
    const at = r.draftAt && r.draftAt.includes("T") ? Date.parse(r.draftAt) : NaN;
    return at > from && at <= to ? [{ ...r, at }] : [];
  });
  summary.drafts = due.length;
  if (!due.length) return summary;

  const ids = due.map((r) => r.leagueId);
  const [paired, started] = await Promise.all([
    db.select({ leagueId: espnBridgeTokens.leagueId }).from(espnBridgeTokens).where(and(inArray(espnBridgeTokens.leagueId, ids), gt(espnBridgeTokens.expiresAt, now))),
    db.select({ leagueId: drafts.leagueId, state: drafts.state }).from(drafts).where(inArray(drafts.leagueId, ids)),
  ]);
  const skip = new Set([...paired.map((p) => p.leagueId), ...started.filter((d) => d.state?.final || d.state?.picks.length).map((d) => d.leagueId)]);

  const byUser = new Map<string, typeof due>();
  for (const r of due) {
    if (skip.has(r.leagueId)) {
      summary.connected++;
      continue;
    }
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  }
  for (const [userId, list] of byUser) {
    const to = list[0].email;
    if (dryRun || !to) continue;
    const email = renderDraftDayEmail({
      leagues: list.map((r) => ({ name: r.name, draftUrl: espnDraftPage(r), time: draftTimeLabel(r.at) })),
      helpUrl: new URL(espnSetup("draft", list[0].leagueId), deps.baseUrl).toString(),
      unsubscribeUrl: unsubscribeUrl(deps, userId),
    });
    const slot = new Date(Math.min(...list.map((r) => r.at))).toISOString();
    if (await sendOnce(db, deps, { job: "draft", userId, to, kind: "draft", slot, now }, email)) summary.emails++;
  }
  return summary;
}
