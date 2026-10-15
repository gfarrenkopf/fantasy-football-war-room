import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { ALERT_KINDS, ALERT_LABELS, PUSH_ONLY, type AlertChannel, type AlertKind } from "@/lib/season/alerts";
import { hasDevice } from "../devices";
import { alertChannels } from "../seasonPrefs";

/** GET/PUT /api/v1/notifications: each season alert and how it reaches the user (21.3). */
export interface NotificationsResponse {
  /** `pushOnly`: there's no email for it, so it's iPhone or off. */
  alerts: { kind: AlertKind; title: string; detail: string; channel: AlertChannel; pushOnly: boolean }[];
  /** This server sends email and the account has an address: email choices do something. */
  email: boolean;
  /** This server sends push notifications. */
  push: boolean;
  /** The user is signed in to the app on an iPhone that can receive them. */
  hasDevice: boolean;
}

export async function notificationsResponse(db: Db, userId: string, server: { email: boolean; push: boolean }): Promise<NotificationsResponse> {
  const [channels, device, [user]] = await Promise.all([
    alertChannels(db, userId),
    hasDevice(db, userId),
    db.select({ email: users.email }).from(users).where(eq(users.id, userId)),
  ]);
  return {
    alerts: ALERT_KINDS.map((kind) => ({ kind, ...ALERT_LABELS[kind], channel: channels[kind], pushOnly: PUSH_ONLY.has(kind) })),
    email: server.email && Boolean(user?.email),
    push: server.push,
    hasDevice: device,
  };
}
