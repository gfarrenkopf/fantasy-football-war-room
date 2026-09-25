import type { Db } from "@/lib/db/types";
import { earlyMoves, kickoffLabel, renderEarlyEmail } from "@/lib/season/email";
import { dueKickoff, type Schedule } from "@/lib/season/schedule";
import type { SeasonViewLoad } from "./espn/seasonView";
import { activeLeagues, jobError, sendOnce, unsubscribeUrl, type JobMail } from "./seasonJobs";

/**
 * The early-kickoff alert (Epic 11, 11.4). The Sunday AI lineup (11.3) comes too late for players
 * whose games kick off first: Thursday nights, London mornings, and the late season's Friday and
 * Saturday games. A timer runs this every 15 minutes; it acts only when an early kickoff is 60-75
 * minutes away, after the inactives are out. For each league opened in the last two weeks, it works
 * out the free optimal lineup (10.5) and emails the changes that involve a player in that game.
 * No AI, so no pass or trial is needed.
 *
 * Reruns are safe: at most one alert per user and kickoff. A lapsed ESPN login is left to the
 * Sunday job's reconnect email.
 */

export interface EarlyDeps extends JobMail {
  schedule: Schedule;
  loadView(userId: string, leagueId: string): Promise<SeasonViewLoad>;
  now?: Date;
}

export interface EarlySummary {
  dryRun: boolean;
  /** The kickoff this run alerted for (ISO), or null when none was due. */
  kickoff: string | null;
  leagues: number;
  inactive: number;
  /** Leagues with a change involving that game. */
  withMoves: number;
  failed: number;
  emails: number;
}

export async function runEarlyJob(db: Db, deps: EarlyDeps, { dryRun = false }: { dryRun?: boolean } = {}): Promise<EarlySummary> {
  const now = deps.now ?? new Date();
  const summary: EarlySummary = { dryRun, kickoff: null, leagues: 0, inactive: 0, withMoves: 0, failed: 0, emails: 0 };
  const due = dueKickoff(deps.schedule, now.getTime());
  if (!due) return summary;
  summary.kickoff = new Date(due.at).toISOString();

  const { total, inactive, byUser } = await activeLeagues(db, now);
  summary.leagues = total;
  summary.inactive = inactive;
  for (const [userId, list] of byUser) {
    const alerts: { name: string; url: string; moves: string[] }[] = [];
    for (const league of list) {
      try {
        const load = await deps.loadView(userId, league.leagueId);
        if (load.kind === "disconnected" || load.kind === "no-login" || load.kind === "not-linked") break; // one login covers every league
        if (load.kind !== "ok" || load.projectionsMissing) {
          jobError("early", "couldn't read the league", { leagueId: league.leagueId, reason: load.kind === "ok" ? "no projections" : load.kind });
          summary.failed++;
          continue;
        }
        if (load.view.currentWeek !== due.week) continue; // ESPN hasn't moved on to that week yet
        const moves = earlyMoves(load.view, due.teams);
        if (!moves.length) continue;
        summary.withMoves++;
        alerts.push({ name: league.name, url: new URL(`/season/${encodeURIComponent(league.leagueId)}`, deps.baseUrl).toString(), moves });
      } catch (error) {
        jobError("early", (error as Error).message, { leagueId: league.leagueId });
        summary.failed++;
      }
    }
    const to = list[0].email;
    if (dryRun || !to || !alerts.length) continue;
    const email = renderEarlyEmail({ kickoff: kickoffLabel(due.at), leagues: alerts, unsubscribeUrl: unsubscribeUrl(deps, userId) });
    if (await sendOnce(db, deps, { job: "early", userId, to, kind: "early", slot: summary.kickoff, now }, email)) summary.emails++;
  }
  return summary;
}
