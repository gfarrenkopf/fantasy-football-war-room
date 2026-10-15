/**
 * The season alerts and how each reaches a user (21.3): by email, by push to the iPhone app, both,
 * or not at all. Pure: no database or config. Storage is src/lib/server/alertPrefs.ts; sending is
 * src/lib/server/notify.ts.
 */

export const ALERT_KINDS = ["lineup", "kickoff", "reminder", "live", "reconnect", "draft"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_CHANNELS = ["email", "push", "both", "off"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

/** What each alert is, in the words the settings screens show. */
export const ALERT_LABELS: Record<AlertKind, { title: string; detail: string }> = {
  lineup: { title: "Sunday AI lineup", detail: "When your Sunday lineup is ready." },
  kickoff: { title: "Before kickoff", detail: "Changes for an early game, and starters ruled out after the Sunday lineup." },
  reminder: { title: "Lineup reminder", detail: "Before the week's first kickoff, when your lineup has a hole." },
  live: { title: "Follow live", detail: "Your matchup on the lock screen from your first kickoff, until it's decided." },
  reconnect: { title: "ESPN reconnect", detail: "When ESPN signs Draft Room out." },
  draft: { title: "Draft day", detail: "Before your draft starts." },
};

/** Alerts that only exist as a push (21.4): there's no email for them. */
export const PUSH_ONLY: ReadonlySet<AlertKind> = new Set(["reminder", "live"]);
/** Push-only alerts that stay off until the user turns them on: starting a Live Activity unasked is too much (21.5). */
const OFF_UNTIL_ASKED: ReadonlySet<AlertKind> = new Set(["live"]);

/** The channels an alert can use. */
export const channelsFor = (kind: AlertKind): readonly AlertChannel[] => (PUSH_ONLY.has(kind) ? ["push", "off"] : ALERT_CHANNELS);

/** The choices a user has made; an alert they haven't touched isn't in it. */
export type StoredAlerts = Partial<Record<AlertKind, AlertChannel>>;

export const sendsEmail = (c: AlertChannel) => c === "email" || c === "both";
export const sendsPush = (c: AlertChannel) => c === "push" || c === "both";
const withoutEmail = (c: AlertChannel): AlertChannel => (c === "both" ? "push" : c === "email" ? "off" : c);

/**
 * Each alert's channel. An untouched alert goes by email for a user without the app, and by email
 * and push once they've signed in on an iPhone; a push-only alert is off until then (and "Follow
 * live" until the user turns it on). `seasonEmails`
 * off (the original "stop these emails" link, before alerts had their own settings) takes email out
 * of the untouched ones.
 */
export function resolveAlerts(stored: StoredAlerts, { seasonEmails, hasDevice }: { seasonEmails: boolean; hasDevice: boolean }): Record<AlertKind, AlertChannel> {
  const fallback: AlertChannel = hasDevice ? "both" : "email";
  const untouched = seasonEmails ? fallback : withoutEmail(fallback);
  return Object.fromEntries(ALERT_KINDS.map((kind) => [kind, stored[kind] ?? (PUSH_ONLY.has(kind) ? (hasDevice && !OFF_UNTIL_ASKED.has(kind) ? "push" : "off") : untouched)])) as Record<AlertKind, AlertChannel>;
}

/** The same channels with email turned off, for `kinds`: what an unsubscribe link does. Push-only alerts have no email to turn off. */
export function emailTurnedOff(channels: Partial<Record<AlertKind, AlertChannel>>, kinds: readonly AlertKind[]): StoredAlerts {
  return Object.fromEntries(kinds.filter((kind) => !PUSH_ONLY.has(kind) && channels[kind]).map((kind) => [kind, withoutEmail(channels[kind]!)]));
}

/** A body's `{ kind: channel }` changes, keeping only known kinds and channels; null if there are none. */
export function parseAlertChanges(body: unknown): StoredAlerts | null {
  const alerts = (body as { alerts?: unknown } | null)?.alerts;
  if (!alerts || typeof alerts !== "object") return null;
  const changes: StoredAlerts = {};
  for (const [kind, channel] of Object.entries(alerts)) {
    if (!isAlertKind(kind) || !(channelsFor(kind) as readonly unknown[]).includes(channel)) return null;
    changes[kind as AlertKind] = channel as AlertChannel;
  }
  return Object.keys(changes).length ? changes : null;
}

export const isAlertKind = (value: unknown): value is AlertKind => (ALERT_KINDS as readonly unknown[]).includes(value);
