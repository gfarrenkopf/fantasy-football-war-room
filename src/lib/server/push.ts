import "server-only";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db";
import { createApnsClient, type ApnsClient } from "./apns";
import { devicesFor, forgetDevice } from "./devices";

/**
 * Push notifications to a user's iPhones (21.2), straight to APNs. Off (a no-op) unless the APNS_*
 * variables are set, so self-hosters and dev servers are unaffected.
 */

export type PushAlert = {
  title: string;
  body: string;
  /** Extra keys beside `aps`, for the app: where a tap should go (21.4). */
  data?: Record<string, string>;
  /** Groups notifications on the phone, e.g. by league. */
  threadId?: string;
  /** The notification category, for actions the app registers. */
  category?: string;
  /** Breaks through Focus modes. Only for alerts that can't wait (a starter ruled out). */
  timeSensitive?: boolean;
  /** A newer push with the same id replaces this one if it's still showing. */
  collapseId?: string;
};

export type PushResult = { sent: number; removed: number; failed: number };

/** The APNs payload for an alert. */
export function alertPayload(alert: PushAlert): Record<string, unknown> {
  return {
    aps: {
      alert: { title: alert.title, body: alert.body },
      sound: "default",
      ...(alert.threadId ? { "thread-id": alert.threadId } : {}),
      ...(alert.category ? { category: alert.category } : {}),
      ...(alert.timeSensitive ? { "interruption-level": "time-sensitive" } : {}),
    },
    ...alert.data,
  };
}

let client: ApnsClient | null | undefined;
/** The APNs client, made once per process; null when push is off. */
export function apnsClient(): ApnsClient | null {
  if (client === undefined) {
    client =
      config.pushEnabled && config.apnsKeyId && config.apnsTeamId && config.apnsPrivateKey
        ? createApnsClient({ keyId: config.apnsKeyId, teamId: config.apnsTeamId, privateKey: config.apnsPrivateKey })
        : null;
  }
  return client;
}

/** One [server-error] line for a push that failed, which the alert emails pick up. Never the token or the key. */
export function logPushError(message: string, detail: Record<string, unknown>): void {
  console.error(`[server-error] ${JSON.stringify({ method: "PUSH", path: "apns", route: "push", message, ...detail })}`);
}

/**
 * Sends an alert to every iPhone the user is signed in on. Tokens APNs says are dead are deleted;
 * other failures are logged. Never throws for a delivery problem.
 */
export async function sendPush(db: Db, userId: string, alert: PushAlert, apns: ApnsClient | null = apnsClient()): Promise<PushResult> {
  const result: PushResult = { sent: 0, removed: 0, failed: 0 };
  if (!apns) return result;
  const payload = alertPayload(alert);
  for (const device of await devicesFor(db, userId)) {
    const outcome = await apns.send(device, { pushType: "alert", topic: config.apnsBundleId, payload, collapseId: alert.collapseId });
    if (outcome.kind === "sent") result.sent++;
    else if (outcome.kind === "dead") {
      await forgetDevice(db, device.token);
      result.removed++;
    } else {
      result.failed++;
      logPushError("APNs refused a push", { status: outcome.status, reason: outcome.reason, environment: device.environment });
    }
  }
  return result;
}

/** For the season jobs: pushes to a user, or null when push is off. Like getEmailSender(). */
export function getPushSender(db: Db): ((userId: string, alert: PushAlert) => Promise<PushResult>) | null {
  const apns = apnsClient();
  return apns ? (userId, alert) => sendPush(db, userId, alert, apns) : null;
}
