import type { PlanModel } from "@/lib/ai/provider";
import type { Db } from "@/lib/db/types";
import { espnLeaguePage } from "@/lib/espn/pages";
import { holeLines, lineupMoves, renderReconnectEmail, renderSundayEmail, type LeagueSummary } from "@/lib/season/email";
import { reconnectPush, sundayPush } from "@/lib/season/pushes";
import { findHoles, type HoleFills } from "@/lib/season/holes";
import type { SeasonViewLoad } from "./espn/seasonView";
import { seasonAiAccess } from "./seasonAi";
import { writeAiLineup } from "./seasonAiOutputs";
import { recordProjections } from "./seasonProjections";
import { notify } from "./notify";
import { activeLeagues, jobError, unsubscribeUrl, type JobLeague, type JobMail } from "./seasonJobs";
import { espnSetup } from "@/lib/espn/pages";

/**
 * The Sunday-morning AI lineup job (Epic 11, 11.3). A timer on the droplet starts it at 11:40 ET,
 * after the inactives for the 1pm games are posted. For every league whose user has opened its
 * season page in the last two weeks, it re-reads ESPN and writes the Sunday AI lineup if the league
 * is paid for, or its account is in a trial it has already started. Then it sends each user one
 * email covering all their leagues, and a push if they've chosen one (21.3). A user whose ESPN login
 * has lapsed gets a reconnect alert instead.
 *
 * Reruns are safe: stored lineups aren't rewritten, and at most one email of each kind goes to a
 * user per day. Failures are logged as [server-error] lines, which the alert emails pick up.
 */

export interface SundayDeps extends JobMail {
  model: PlanModel;
  /** The league's season view, fresh from ESPN. */
  loadView(userId: string, leagueId: string): Promise<SeasonViewLoad>;
  /** The best ways to fill this week's lineup holes (APE-352), or null when the wire can't be read. */
  loadFills?(userId: string, leagueId: string): Promise<readonly HoleFills[] | null>;
  paymentsEnabled: boolean;
  allowlist: readonly string[];
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
  /** Phones the lineup and reconnect alerts were pushed to. */
  pushes: number;
}

export async function runSundayJob(db: Db, deps: SundayDeps, { dryRun = false }: { dryRun?: boolean } = {}): Promise<SundaySummary> {
  const now = deps.now ?? new Date();
  const summary: SundaySummary = { dryRun, leagues: 0, inactive: 0, notEntitled: 0, notConnected: 0, written: 0, existing: 0, failed: 0, emails: 0, reconnects: 0, pushes: 0 };
  const { total, inactive, byUser } = await activeLeagues(db, now);
  summary.leagues = total;
  summary.inactive = inactive;

  for (const [userId, list] of byUser) {
    const lineups: (LeagueSummary & { leagueId: string })[] = [];
    let reconnect: JobLeague | null = null;
    for (const league of list) {
      const outcome = await runLeague(db, deps, league, { dryRun, lineups });
      if (outcome === "disconnected") {
        reconnect = league;
        break; // one ESPN login covers all of a user's leagues
      }
      summary[outcome]++;
    }
    const to = list[0].email;
    if (dryRun || !to) continue;
    if (lineups.length) {
      const sent = await notify(db, deps, { job: "sunday", userId, to, kind: "lineup", now }, {
        email: renderSundayEmail({ leagues: lineups, unsubscribeUrl: unsubscribeUrl(deps, userId, "lineup") }),
        push: sundayPush(lineups),
      });
      if (sent.email) summary.emails++;
      summary.pushes += sent.push;
    }
    if (reconnect) {
      const sent = await notify(db, deps, { job: "sunday", userId, to, kind: "reconnect", now }, {
        email: renderReconnectEmail({ espnUrl: espnLeaguePage(reconnect), helpUrl: new URL(espnSetup("season"), deps.baseUrl).toString(), unsubscribeUrl: unsubscribeUrl(deps, userId, "reconnect") }),
        push: reconnectPush(),
      });
      if (sent.email) summary.reconnects++;
      summary.pushes += sent.push;
    }
  }
  return summary;
}

type LeagueOutcome = "written" | "existing" | "notEntitled" | "notConnected" | "failed" | "disconnected";

async function runLeague(db: Db, deps: SundayDeps, league: JobLeague, { dryRun, lineups }: { dryRun: boolean; lineups: (LeagueSummary & { leagueId: string })[] }): Promise<LeagueOutcome> {
  try {
    const load = await deps.loadView(league.userId, league.leagueId);
    if (load.kind === "disconnected") return "disconnected";
    if (load.kind === "no-login" || load.kind === "not-linked") return "notConnected";
    if (load.kind !== "ok" || load.projectionsMissing) {
      jobError("sunday", "couldn't read the league", { leagueId: league.leagueId, reason: load.kind === "ok" ? "no projections" : load.kind });
      return "failed";
    }
    const { view } = load;
    // ESPN's numbers an hour before the main slot, for game day's "ESPN's call" (APE-229).
    if (!dryRun) await recordProjections(db, league.leagueId, view).catch((err: Error) => jobError("sunday", `couldn't record projections: ${err.message}`, { leagueId: league.leagueId }));
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
      jobError("sunday", "the model failed", { leagueId: league.leagueId, reason: result.status === "failed" ? result.kind : result.status });
      return "failed";
    }
    // A slot nobody can play leads the league's section, with the pickup that fills it when the wire reads.
    const holes = findHoles(view).filter((h) => h.kind === "hard");
    const fills = holes.length && deps.loadFills ? await deps.loadFills(league.userId, league.leagueId).catch(() => null) : null;
    lineups.push({
      leagueId: league.leagueId,
      name: league.name,
      url: new URL(`/season/${encodeURIComponent(league.leagueId)}`, deps.baseUrl).toString(),
      gain: result.output.total - view.lineup.currentTotal,
      moves: lineupMoves(view, result.output),
      holes: holeLines(view, holes, fills ?? undefined),
    });
    return result.cached ? "existing" : "written";
  } catch (error) {
    jobError("sunday", (error as Error).message, { leagueId: league.leagueId });
    return "failed";
  }
}
