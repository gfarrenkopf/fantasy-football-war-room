import type { Db } from "@/lib/db/types";
import { earlyMoves, gameHoles, holeLines, kickoffLabel, lateHoles, renderEarlyEmail } from "@/lib/season/email";
import { earlyPush, reminderPush, ruledOutPush, type RuledOut } from "@/lib/season/pushes";
import { findHoles, type HoleFills } from "@/lib/season/holes";
import { dueKickoff, earlyKickoffs, type Schedule } from "@/lib/season/schedule";
import type { SeasonViewLoad } from "./espn/seasonView";
import { recordProjections } from "./seasonProjections";
import { notify } from "./notify";
import { activeLeagues, jobError, unsubscribeUrl, type JobMail } from "./seasonJobs";

/**
 * The early-kickoff alert (Epic 11, 11.4). The Sunday AI lineup (11.3) comes too late for players
 * whose games kick off first: Thursday nights, London mornings, and the late season's Friday and
 * Saturday games. A timer runs this every 15 minutes; it acts only when an early kickoff is 60-75
 * minutes away, after the inactives are out. For each league opened in the last two weeks, it works
 * out the free optimal lineup (10.5) and emails the changes that involve a player in that game.
 * No AI, so no pass or trial is needed.
 *
 * The same timer covers the kickoffs after the Sunday 1 PM slot (APE-347): the late afternoon games,
 * Sunday and Monday nights. Their inactives come out after the Sunday email, so a starter ruled out
 * there would go unnoticed. For those, it emails only the holes, with the pickup that fills each.
 *
 * Before the week's first kickoff it also pushes a lineup reminder (21.4) to users with the app, for
 * the holes no kickoff alert covers yet: an empty slot, a starter on a bye or ruled out.
 *
 * Reruns are safe: at most one alert per user and kickoff. A lapsed ESPN login is left to the
 * Sunday job's reconnect email.
 */

export interface EarlyDeps extends JobMail {
  schedule: Schedule;
  loadView(userId: string, leagueId: string): Promise<SeasonViewLoad>;
  /** The best ways to fill this week's lineup holes (APE-352), or null when the wire can't be read. */
  loadFills?(userId: string, leagueId: string): Promise<readonly HoleFills[] | null>;
  now?: Date;
}

export interface EarlySummary {
  dryRun: boolean;
  /** The kickoff this run alerted for (ISO), or null when none was due. */
  kickoff: string | null;
  leagues: number;
  inactive: number;
  /** Whether that kickoff came before the Sunday job, or after the main slot (APE-347). */
  when: "early" | "late" | null;
  /** Leagues with a change involving that game: for a late kickoff, a hole. */
  withMoves: number;
  failed: number;
  emails: number;
  /** Phones the alert was pushed to (21.3). */
  pushes: number;
  /** Phones the lineup reminder was pushed to, before the week's first kickoff (21.4). */
  reminders: number;
}

export async function runEarlyJob(db: Db, deps: EarlyDeps, { dryRun = false }: { dryRun?: boolean } = {}): Promise<EarlySummary> {
  const now = deps.now ?? new Date();
  const summary: EarlySummary = { dryRun, kickoff: null, when: null, leagues: 0, inactive: 0, withMoves: 0, failed: 0, emails: 0, pushes: 0, reminders: 0 };
  const due = dueKickoff(deps.schedule, now.getTime());
  if (!due) return summary;
  summary.kickoff = new Date(due.at).toISOString();
  summary.when = due.when;

  const { total, inactive, byUser } = await activeLeagues(db, now);
  summary.leagues = total;
  summary.inactive = inactive;
  // Before the week's first kickoff, a reminder covers the holes no kickoff alert has yet (21.4).
  const firstOfWeek = earlyKickoffs(deps.schedule.get(due.week) ?? new Map())[0] === due.at;
  for (const [userId, list] of byUser) {
    const alerts: { leagueId: string; name: string; url: string; moves: string[] }[] = [];
    const ruledOut: RuledOut[] = [];
    const reminders: { leagueId: string; name: string; lines: string[] }[] = [];
    for (const league of list) {
      try {
        const load = await deps.loadView(userId, league.leagueId);
        if (load.kind === "disconnected" || load.kind === "no-login" || load.kind === "not-linked") break; // one login covers every league
        if (load.kind !== "ok" || load.projectionsMissing) {
          jobError("early", "couldn't read the league", { leagueId: league.leagueId, reason: load.kind === "ok" ? "no projections" : load.kind });
          summary.failed++;
          continue;
        }
        // ESPN's numbers before an early kickoff, for game day's "ESPN's call" (APE-229).
        if (!dryRun) await recordProjections(db, league.leagueId, load.view).catch((err: Error) => jobError("early", `couldn't record projections: ${err.message}`, { leagueId: league.leagueId }));
        if (load.view.currentWeek !== due.week) continue; // ESPN hasn't moved on to that week yet
        // A hole leads with the pickup that fills it, when the wire reads.
        const holes = gameHoles(load.view, due.teams);
        const fills = holes.length && deps.loadFills ? ((await deps.loadFills(userId, league.leagueId).catch(() => null)) ?? undefined) : undefined;
        const moves = due.when === "early" ? earlyMoves(load.view, due.teams, fills) : lateHoles(load.view, due.teams, fills);
        if (due.when === "late") {
          const roster = load.view.teams.find((t) => t.id === load.view.myTeamId)?.roster ?? [];
          for (const hole of holes) {
            const name = roster.find((p) => p.playerId === hole.playerId)?.name ?? null;
            ruledOut.push({ leagueId: league.leagueId, league: league.name, playerId: hole.playerId, name, line: holeLines(load.view, [hole], fills)[0] });
          }
        }
        if (firstOfWeek) {
          const later = findHoles(load.view).filter((h) => h.kind === "hard" && !holes.some((g) => g.key === h.key && g.playerId === h.playerId));
          if (later.length) reminders.push({ leagueId: league.leagueId, name: league.name, lines: holeLines(load.view, later) });
        }
        if (!moves.length) continue;
        summary.withMoves++;
        alerts.push({ leagueId: league.leagueId, name: league.name, url: new URL(`/season/${encodeURIComponent(league.leagueId)}`, deps.baseUrl).toString(), moves });
      } catch (error) {
        jobError("early", (error as Error).message, { leagueId: league.leagueId });
        summary.failed++;
      }
    }
    if (dryRun) continue;
    const to = list[0].email;
    if (alerts.length) {
      const kickoff = kickoffLabel(due.at);
      const email = renderEarlyEmail({ kickoff, when: due.when, leagues: alerts, unsubscribeUrl: unsubscribeUrl(deps, userId, "kickoff") });
      const push = due.when === "late" && ruledOut.length ? ruledOutPush({ kickoff, holes: ruledOut }) : earlyPush({ kickoff, leagues: alerts });
      const sent = await notify(db, deps, { job: "early", userId, to, kind: "early", slot: summary.kickoff, now }, { email, push });
      if (sent.email) summary.emails++;
      summary.pushes += sent.push;
    }
    if (reminders.length) {
      const sent = await notify(db, deps, { job: "early", userId, to, kind: "reminder", slot: summary.kickoff, now }, { push: reminderPush(reminders) });
      summary.reminders += sent.push;
    }
  }
  return summary;
}
