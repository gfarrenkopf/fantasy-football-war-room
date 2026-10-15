import { and, eq } from "drizzle-orm";
import { seasonEmails, type SeasonEmailKind } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { sendsEmail, sendsPush, type AlertKind } from "@/lib/season/alerts";
import type { SeasonEmail } from "@/lib/season/email";
import type { PushAlert } from "./push";
import { jobError, unsubscribeUrl, type JobMail } from "./seasonJobs";
import { alertChannels } from "./seasonPrefs";

/** Which setting governs each kind of season job message. */
export const ALERT_FOR: Record<SeasonEmailKind, AlertKind> = { lineup: "lineup", reconnect: "reconnect", early: "kickoff", draft: "draft" };

export type Notified = { email: boolean; push: number };

/**
 * The one way a season job alerts a user (21.3): by email, by push, or both, as they've chosen for
 * that alert (alertChannels()). At most once per user, kind, day and slot: the row is claimed
 * before sending and released if nothing went out, so a rerun tries again.
 *
 * `to` is the user's email address, or null when they have none; the message is skipped on any
 * channel this server can't send.
 */
export async function notify(
  db: Db,
  deps: JobMail,
  { job, userId, to, kind, slot = "", now }: { job: string; userId: string; to: string | null; kind: SeasonEmailKind; slot?: string; now: Date },
  message: { email?: SeasonEmail; push?: PushAlert },
): Promise<Notified> {
  const none: Notified = { email: false, push: 0 };
  const channel = (await alertChannels(db, userId, now))[ALERT_FOR[kind]];
  const email = sendsEmail(channel) && deps.sendEmail && to && message.email ? { send: deps.sendEmail, to, body: message.email } : null;
  const push = sendsPush(channel) && deps.sendPush && message.push ? { send: deps.sendPush, alert: message.push } : null;
  if (!email && !push) return none;

  const sentOn = now.toISOString().slice(0, 10);
  const claimed = await db.insert(seasonEmails).values({ userId, kind, sentOn, slot, sentAt: now }).onConflictDoNothing().returning({ kind: seasonEmails.kind });
  if (!claimed.length) return none;

  const result: Notified = { email: false, push: 0 };
  if (email) {
    const oneClick = unsubscribeUrl(deps, userId, ALERT_FOR[kind]).replace("/season/unsubscribe", "/api/season/unsubscribe");
    try {
      await email.send(email.to, email.body, { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
      result.email = true;
    } catch (error) {
      jobError(job, `couldn't send the ${kind} email: ${(error as Error).message}`, { userId });
    }
  }
  if (push) {
    try {
      result.push = (await push.send(userId, push.alert)).sent;
    } catch (error) {
      jobError(job, `couldn't push the ${kind} alert: ${(error as Error).message}`, { userId });
    }
  }
  if (!result.email && !result.push) {
    await db.delete(seasonEmails).where(and(eq(seasonEmails.userId, userId), eq(seasonEmails.kind, kind), eq(seasonEmails.sentOn, sentOn), eq(seasonEmails.slot, slot)));
  }
  return result;
}
