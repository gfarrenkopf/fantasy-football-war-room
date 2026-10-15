import { isDeepStrictEqual } from "node:util";
import { and, eq, gt, isNull } from "drizzle-orm";
import { deviceTokens, leagues, liveActivities, seasonEmails, sessions, type ApnsEnvironment } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { sendsPush } from "@/lib/season/alerts";
import { gameDayPhase } from "@/lib/season/gameday";
import type { LiveMatchup } from "@/lib/season/liveMatchup";
import type { Schedule } from "@/lib/season/schedule";
import type { ApnsClient } from "./apns";
import { startTokensFor } from "./devices";
import type { SeasonViewLoad } from "./espn/seasonView";
import { activeLeagues, jobError } from "./seasonJobs";
import { alertChannels } from "./seasonPrefs";
import { liveMatchup } from "./v1/season";

/**
 * The Game day Live Activity (21.5): the user's matchup on the lock screen and in the Dynamic Island,
 * kept current by APNs `liveactivity` pushes. The app starts one from Game day ("Follow live") and
 * registers its update token here; with "Follow live" turned on in alerts, the live job also starts
 * one with a push-to-start token when the user's first game kicks off.
 *
 * The content state is the season response's `live` sub-object (LiveMatchup), so the app and the
 * activity decode the same thing. Apple budgets updates, so they're throttled: a change at most once
 * a minute, high priority only when the score moves, and an end push once the week is decided.
 */

/** The Swift type the activity is declared with (ActivityAttributes), named in push-to-start. */
export const LIVE_ATTRIBUTES_TYPE = "GameDayAttributes";
/** The activity's fixed part: which league it follows. */
export type LiveAttributes = { leagueId: string; league: string };

/** The fewest milliseconds between two updates to one activity, except the final one. */
export const UPDATE_EVERY_MS = 60_000;
/** A content state older than this shows as stale on the phone: the job has stopped sending. */
const STALE_AFTER_MS = 10 * 60_000;
/** An ended activity stays on the lock screen this long with the final score. */
const DISMISS_AFTER_MS = 2 * 60 * 60_000;
/** How long after a kickoff its game can still be on, for the push-to-start check. */
const GAME_MS = 4 * 60 * 60_000;

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/** The APNs payload for a Live Activity event. */
export function livePayload(
  event: "start" | "update" | "end",
  state: LiveMatchup,
  now: Date,
  opts: { attributes?: LiveAttributes; alert?: { title: string; body: string } } = {},
): Record<string, unknown> {
  return {
    aps: {
      timestamp: seconds(now),
      event,
      "content-state": state,
      ...(event === "end" ? { "dismissal-date": seconds(new Date(now.getTime() + DISMISS_AFTER_MS)) } : { "stale-date": seconds(new Date(now.getTime() + STALE_AFTER_MS)) }),
      ...(event === "start" && opts.attributes ? { "attributes-type": LIVE_ATTRIBUTES_TYPE, attributes: opts.attributes } : {}),
      ...(opts.alert ? { alert: opts.alert } : {}),
    },
  };
}

/** By value: the stored state comes back from jsonb with its keys reordered. */
const sameState = (a: LiveMatchup, b: LiveMatchup) => isDeepStrictEqual(a, b);

/**
 * Whether to push `next` to an activity that last got `prev` at `sentAt`: only a change, at most
 * once a minute, except the final state, which always goes and ends the activity.
 */
export function nextSend(prev: LiveMatchup | null, sentAt: Date | null, next: LiveMatchup, now: Date): { send: false } | { send: true; priority: 5 | 10; end: boolean } {
  if (next.decided) return { send: true, priority: 10, end: true };
  if (prev && sameState(prev, next)) return { send: false };
  if (sentAt && now.getTime() - sentAt.getTime() < UPDATE_EVERY_MS) return { send: false };
  const scored = !prev || prev.me.points !== next.me.points || prev.them.points !== next.them.points;
  return { send: true, priority: scored ? 10 : 5, end: false };
}

/** Registers an activity the app started (or one push-to-start started) for a league's week. Re-registering moves it to this session. */
export async function registerLiveActivity(
  db: Db,
  { userId, sessionToken, leagueId, token, environment, week }: { userId: string; sessionToken: string; leagueId: string; token: string; environment: ApnsEnvironment; week: number },
  now = new Date(),
): Promise<void> {
  await db
    .insert(liveActivities)
    .values({ token, userId, sessionToken, leagueId, environment, week, createdAt: now })
    .onConflictDoUpdate({ target: liveActivities.token, set: { userId, sessionToken, leagueId, environment, week, endedAt: null } });
}

/** The user ended the activity on the phone: stop pushing to it. */
export async function removeLiveActivity(db: Db, userId: string, token: string): Promise<void> {
  await db.delete(liveActivities).where(and(eq(liveActivities.userId, userId), eq(liveActivities.token, token.toLowerCase())));
}

export interface LiveDeps {
  loadView(userId: string, leagueId: string): Promise<SeasonViewLoad>;
  /** Null when push is off: the job then does nothing. */
  apns: ApnsClient | null;
  /** The app's bundle ID; Live Activity pushes go to `<bundle>.push-type.liveactivity`. */
  bundleId: string;
  /** This season's kickoffs: push-to-start only looks while a game is on. Absent, it never starts one. */
  schedule?: Schedule;
  now?: Date;
}

export interface LiveSummary {
  dryRun: boolean;
  /** Activities running, on live sessions. */
  activities: number;
  updated: number;
  ended: number;
  started: number;
  failed: number;
}

export async function runLiveJob(db: Db, deps: LiveDeps, { dryRun = false }: { dryRun?: boolean } = {}): Promise<LiveSummary> {
  const now = deps.now ?? new Date();
  const summary: LiveSummary = { dryRun, activities: 0, updated: 0, ended: 0, started: 0, failed: 0 };
  if (!deps.apns) return summary;
  const apns = deps.apns;
  const topic = `${deps.bundleId}.push-type.liveactivity`;

  // One read per league, shared by every activity following it.
  const views = new Map<string, Promise<SeasonViewLoad | null>>();
  const view = (userId: string, leagueId: string) => {
    const key = `${userId}:${leagueId}`;
    if (!views.has(key)) {
      views.set(
        key,
        deps.loadView(userId, leagueId).catch((err: Error) => {
          jobError("live", err.message, { leagueId });
          summary.failed++;
          return null;
        }),
      );
    }
    return views.get(key)!;
  };

  const rows = await db
    .select()
    .from(liveActivities)
    .innerJoin(sessions, eq(sessions.sessionToken, liveActivities.sessionToken))
    .where(and(isNull(liveActivities.endedAt), gt(sessions.expires, now)));
  summary.activities = rows.length;
  for (const { live_activities: row } of rows) {
    const load = await view(row.userId, row.leagueId);
    if (load?.kind !== "ok") continue;
    let next: LiveMatchup | null;
    let decision: ReturnType<typeof nextSend>;
    if (load.view.currentWeek !== row.week) {
      // ESPN has moved on: end it on the last score it showed.
      if (!row.state) {
        await db.update(liveActivities).set({ endedAt: now }).where(eq(liveActivities.token, row.token));
        continue;
      }
      next = row.state;
      decision = { send: true, priority: 10, end: true };
    } else {
      next = liveMatchup(load.view, gameDayPhase(load.view, now.getTime()));
      if (!next) continue;
      decision = nextSend(row.state, row.sentAt, next, now);
    }
    if (!decision.send) continue;
    if (dryRun) {
      if (decision.end) summary.ended++;
      else summary.updated++;
      continue;
    }
    const outcome = await apns.send(
      { token: row.token, environment: row.environment },
      { pushType: "liveactivity", topic, payload: livePayload(decision.end ? "end" : "update", next, now), priority: decision.priority },
    );
    if (outcome.kind === "dead") {
      await db.delete(liveActivities).where(eq(liveActivities.token, row.token));
    } else if (outcome.kind === "failed") {
      summary.failed++;
      jobError("live", "APNs refused a Live Activity update", { status: outcome.status, reason: outcome.reason, leagueId: row.leagueId });
    } else {
      await db.update(liveActivities).set({ state: next, sentAt: now, ...(decision.end ? { endedAt: now } : {}) }).where(eq(liveActivities.token, row.token));
      if (decision.end) summary.ended++;
      else summary.updated++;
    }
  }

  if (!dryRun && deps.schedule && gameOn(deps.schedule, now)) await startActivities(db, apns, topic, view, now, summary);
  return summary;
}

/** Some NFL game is on now, or kicked off within the last few hours. */
function gameOn(schedule: Schedule, now: Date): boolean {
  for (const week of schedule.values()) for (const at of week.values()) if (at <= now.getTime() && now.getTime() < at + GAME_MS) return true;
  return false;
}

/**
 * Push-to-start: for users who turned "Follow live" on and have an iPhone that can start one, an
 * activity for each league whose matchup has started, once per league and week, unless one runs.
 */
async function startActivities(db: Db, apns: ApnsClient, topic: string, view: (userId: string, leagueId: string) => Promise<SeasonViewLoad | null>, now: Date, summary: LiveSummary) {
  const { byUser } = await activeLeagues(db, now);
  for (const [userId, list] of byUser) {
    if (!sendsPush((await alertChannels(db, userId, now)).live)) continue;
    const devices = await startTokensFor(db, userId, now);
    if (!devices.length) continue;
    for (const league of list) {
      const running = await db
        .select({ token: liveActivities.token })
        .from(liveActivities)
        .where(and(eq(liveActivities.leagueId, league.leagueId), isNull(liveActivities.endedAt)))
        .limit(1);
      if (running.length) continue;
      const load = await view(userId, league.leagueId);
      if (load?.kind !== "ok") continue;
      const live = liveMatchup(load.view, gameDayPhase(load.view, now.getTime()));
      if (!live?.started || live.decided) continue;
      // Once per league and week, whatever the day: the date column is fixed and the slot names the week.
      const claimed = await db
        .insert(seasonEmails)
        .values({ userId, kind: "live", sentOn: "1970-01-01", slot: `${league.leagueId}:${load.view.season}:${live.week}`, sentAt: now })
        .onConflictDoNothing()
        .returning({ kind: seasonEmails.kind });
      if (!claimed.length) continue;
      const [row] = await db.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, league.leagueId));
      const attributes = { leagueId: league.leagueId, league: row?.name ?? league.name };
      for (const device of devices) {
        const outcome = await apns.send(device, {
          pushType: "liveactivity",
          topic,
          payload: livePayload("start", live, now, { attributes, alert: { title: `${attributes.league} is live`, body: live.status } }),
          priority: 10,
        });
        if (outcome.kind === "sent") summary.started++;
        else if (outcome.kind === "failed") {
          summary.failed++;
          jobError("live", "APNs refused a Live Activity start", { status: outcome.status, reason: outcome.reason, leagueId: league.leagueId });
        } else {
          await forgetStartToken(db, device.token);
        }
      }
    }
  }
}

/** A dead push-to-start token. Only it goes: the device can still get alerts, and the app sends a fresh one on launch. */
async function forgetStartToken(db: Db, token: string) {
  await db.update(deviceTokens).set({ startToken: null }).where(eq(deviceTokens.startToken, token));
}
