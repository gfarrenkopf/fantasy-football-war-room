import { and, eq, isNull } from "drizzle-orm";
import type { PlanModel } from "@/lib/ai/provider";
import { espnSeasonLinks, leagues, seasonEmails, users, type SeasonEmailKind } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { lineupMoves, renderReconnectEmail, renderSundayEmail, type LeagueSummary, type SeasonEmail } from "@/lib/season/email";
import type { SeasonViewLoad } from "./espn/seasonView";
import { seasonAiAccess } from "./seasonAi";
import { writeAiLineup } from "./seasonAiOutputs";
import { unsubscribeToken, wantsSeasonEmails } from "./seasonPrefs";

/**
 * The Sunday-morning AI lineup job (Epic 11, 11.3). A timer on the droplet starts it at 11:40 ET,
 * after the inactives for the 1pm games are posted. For every league whose user has opened its
 * season page in the last two weeks, it re-reads ESPN and writes the Sunday AI lineup if the league
 * is paid for, or its account is in a trial it has already started. Then it sends each user one
 * email covering all their leagues. A user whose ESPN login has lapsed gets a reconnect email instead.
 *
 * Reruns are safe: stored lineups aren't rewritten, and at most one email of each kind goes to a
 * user per day. Failures are logged as [server-error] lines, which the alert emails pick up.
 */

/** Leagues nobody has opened for this long are skipped, to save AI cost. Opening the page re-enrols them. */
export const INACTIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export interface SundayDeps {
  model: PlanModel;
  /** The league's season view, fresh from ESPN. */
  loadView(userId: string, leagueId: string): Promise<SeasonViewLoad>;
  /** Sends one email, or null when email isn't configured (lineups are still written). */
  sendEmail: ((to: string, email: SeasonEmail, headers: Record<string, string>) => Promise<void>) | null;
  paymentsEnabled: boolean;
  allowlist: readonly string[];
  /** The public origin, for links in emails. */
  baseUrl: string;
  /** Signs unsubscribe links. */
  secret: string;
  now?: Date;
}

export interface SundaySummary {
  dryRun: boolean;
  /** Connected leagues considered. */
  leagues: number;
  /** Skipped: not opened for two weeks. */
  inactive: number;
  /** Skipped: no pass, and no trial in progress. */
  notEntitled: number;
  /** Skipped: the user disconnected ESPN, or the league no longer follows one. */
  notConnected: number;
  /** Lineups written by this run (or, in a dry run, that would be). */
  written: number;
  /** Lineups already there from an earlier run. */
  existing: number;
  failed: number;
  emails: number;
  reconnects: number;
}

interface Candidate {
  userId: string;
  email: string | null;
  leagueId: string;
  name: string;
  leagueSeason: number;
  lastViewedAt: Date | null;
}

const logError = (message: string, detail: Record<string, unknown>) =>
  console.error(`[server-error] ${JSON.stringify({ method: "JOB", path: "/api/internal/season/sunday", route: "season-sunday", message, ...detail })}`);

export async function runSundayJob(db: Db, deps: SundayDeps, { dryRun = false }: { dryRun?: boolean } = {}): Promise<SundaySummary> {
  const now = deps.now ?? new Date();
  const summary: SundaySummary = { dryRun, leagues: 0, inactive: 0, notEntitled: 0, notConnected: 0, written: 0, existing: 0, failed: 0, emails: 0, reconnects: 0 };
  const rows: Candidate[] = await db
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
  summary.leagues = rows.length;

  const byUser = new Map<string, Candidate[]>();
  for (const row of rows) {
    if (!row.lastViewedAt || now.getTime() - row.lastViewedAt.getTime() > INACTIVE_AFTER_MS) {
      summary.inactive++;
      continue;
    }
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  }

  for (const [userId, list] of byUser) {
    const lineups: LeagueSummary[] = [];
    let reconnect = false;
    for (const league of list) {
      const outcome = await runLeague(db, deps, league, { dryRun, lineups });
      if (outcome === "disconnected") {
        reconnect = true;
        break; // one ESPN login covers all of a user's leagues
      }
      summary[outcome]++;
    }
    const email = list[0].email;
    if (dryRun || !deps.sendEmail || !email) continue;
    if (lineups.length && (await sendOnce(db, deps, userId, email, "lineup", now, renderSundayEmail({ leagues: lineups, unsubscribeUrl: unsubscribeUrl(deps, userId) })))) summary.emails++;
    if (reconnect && (await sendOnce(db, deps, userId, email, "reconnect", now, renderReconnectEmail({ url: new URL("/espn", deps.baseUrl).toString(), unsubscribeUrl: unsubscribeUrl(deps, userId) })))) summary.reconnects++;
  }
  return summary;
}

function unsubscribeUrl(deps: SundayDeps, userId: string): string {
  const url = new URL("/season/unsubscribe", deps.baseUrl);
  url.searchParams.set("u", userId);
  url.searchParams.set("t", unsubscribeToken(deps.secret, userId));
  return url.toString();
}

type LeagueOutcome = "written" | "existing" | "notEntitled" | "notConnected" | "failed" | "disconnected";

async function runLeague(db: Db, deps: SundayDeps, league: Candidate, { dryRun, lineups }: { dryRun: boolean; lineups: LeagueSummary[] }): Promise<LeagueOutcome> {
  try {
    const load = await deps.loadView(league.userId, league.leagueId);
    if (load.kind === "disconnected") return "disconnected";
    if (load.kind === "no-login" || load.kind === "not-linked") return "notConnected";
    if (load.kind !== "ok" || load.projectionsMissing) {
      logError("Sunday lineup: couldn't read the league", { leagueId: league.leagueId, reason: load.kind === "ok" ? "no projections" : load.kind });
      return "failed";
    }
    const { view } = load;
    const access = await seasonAiAccess(db, {
      paymentsEnabled: deps.paymentsEnabled,
      allowlist: deps.allowlist,
      userId: league.userId,
      email: league.email,
      leagueId: league.leagueId,
      leagueSeason: league.leagueSeason,
      season: view.season,
      week: view.currentWeek,
    });
    // A trial starts when the user first asks for AI, never from this job.
    if (access.kind !== "allowed" || (access.via === "trial" && !access.started)) return "notEntitled";
    if (dryRun) return "written";

    const result = await writeAiLineup(db, deps.model, { userId: league.userId, leagueId: league.leagueId, view, kind: "lineup-sunday" });
    if (result.status === "used") return "existing";
    if (result.status !== "ok") {
      logError("Sunday lineup: the model failed", { leagueId: league.leagueId, reason: result.status === "failed" ? result.kind : result.status });
      return "failed";
    }
    lineups.push({
      name: league.name,
      url: new URL(`/season/${encodeURIComponent(league.leagueId)}`, deps.baseUrl).toString(),
      gain: result.output.total - view.lineup.currentTotal,
      moves: lineupMoves(view, result.output),
    });
    return result.cached ? "existing" : "written";
  } catch (error) {
    logError(`Sunday lineup: ${(error as Error).message}`, { leagueId: league.leagueId });
    return "failed";
  }
}

/** Sends `email` unless this user already got one of this kind today, or opted out. */
async function sendOnce(db: Db, deps: SundayDeps, userId: string, to: string, kind: SeasonEmailKind, now: Date, email: SeasonEmail): Promise<boolean> {
  if (!(await wantsSeasonEmails(db, userId))) return false;
  const sentOn = now.toISOString().slice(0, 10);
  const claimed = await db.insert(seasonEmails).values({ userId, kind, sentOn, sentAt: now }).onConflictDoNothing().returning({ kind: seasonEmails.kind });
  if (!claimed.length) return false;
  const url = unsubscribeUrl(deps, userId);
  try {
    await deps.sendEmail!(to, email, { "List-Unsubscribe": `<${url.replace("/season/unsubscribe", "/api/season/unsubscribe")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    return true;
  } catch (error) {
    await db.delete(seasonEmails).where(and(eq(seasonEmails.userId, userId), eq(seasonEmails.kind, kind), eq(seasonEmails.sentOn, sentOn)));
    logError(`Sunday lineup: couldn't send the ${kind} email: ${(error as Error).message}`, { userId });
    return false;
  }
}
