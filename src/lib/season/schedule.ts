import { PRO_TEAMS } from "@/lib/espn/proTeams";

/**
 * The NFL schedule as the early-kickoff alert (11.4) needs it: when each team kicks off, week by
 * week, from ESPN's public `proTeamSchedules_wl` view. Teams are keyed by the same abbreviations as
 * roster entries (PRO_TEAMS), so a player's `team` finds his game.
 */

/** Kickoff times (epoch ms) by team, for one NFL week. */
export type WeekKickoffs = ReadonlyMap<string, number>;

/** Kickoff times by team, by NFL week (ESPN's scoringPeriodId). */
export type Schedule = ReadonlyMap<number, WeekKickoffs>;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Parses the view. A game whose time isn't set yet (`startTimeTBD`, e.g. a late-season game the
 * league may flex) is left out: ESPN parks those at a placeholder hour.
 */
export function parseSchedule(raw: unknown): Schedule {
  const teams = isObject(raw) && isObject(raw.settings) && Array.isArray(raw.settings.proTeams) ? raw.settings.proTeams : [];
  const weeks = new Map<number, Map<string, number>>();
  for (const t of teams) {
    if (!isObject(t) || typeof t.id !== "number" || !isObject(t.proGamesByScoringPeriod)) continue;
    const team = PRO_TEAMS[t.id];
    if (!team) continue;
    for (const [week, games] of Object.entries(t.proGamesByScoringPeriod)) {
      if (!Array.isArray(games)) continue;
      for (const g of games) {
        if (!isObject(g) || typeof g.date !== "number" || g.startTimeTBD === true) continue;
        const byTeam = weeks.get(Number(week)) ?? new Map<string, number>();
        byTeam.set(team, g.date);
        weeks.set(Number(week), byTeam);
      }
    }
  }
  return weeks;
}

/** How long before an early kickoff the alert goes out: after the inactives (~90 minutes before). */
export const ALERT_LEAD_MS = 75 * 60 * 1000;
/** The alert job runs this often; each early kickoff falls in exactly one run's window. */
export const ALERT_EVERY_MS = 15 * 60 * 1000;
/**
 * The Sunday AI lineup (11.3) runs this long before the week's main slot (11:40 ET for the 1 PM
 * games). A kickoff before that run is "early": the Sunday job comes too late for its players.
 */
const SUNDAY_JOB_LEAD_MS = 80 * 60 * 1000;

/**
 * The week's early kickoffs, in order: every kickoff before the Sunday job. The main slot is the
 * one with the most games, so no weekday or time zone is assumed: Thursday nights, London mornings,
 * and the late season's Friday and Saturday games all fall out of it.
 */
export function earlyKickoffs(week: WeekKickoffs): number[] {
  const games = new Map<number, number>();
  for (const at of week.values()) games.set(at, (games.get(at) ?? 0) + 1);
  if (!games.size) return [];
  const main = [...games].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return [...games.keys()].filter((at) => at < main - SUNDAY_JOB_LEAD_MS).sort((a, b) => a - b);
}

export interface DueKickoff {
  week: number;
  at: number;
  /** The teams playing then. */
  teams: string[];
}

/** The early kickoff whose alert is due at `now`: kickoff 60-75 minutes away. Null most of the time. */
export function dueKickoff(schedule: Schedule, now: number): DueKickoff | null {
  for (const [week, byTeam] of schedule) {
    for (const at of earlyKickoffs(byTeam)) {
      if (now >= at - ALERT_LEAD_MS && now < at - ALERT_LEAD_MS + ALERT_EVERY_MS) {
        return { week, at, teams: [...byTeam].filter(([, t]) => t === at).map(([team]) => team).sort() };
      }
    }
  }
  return null;
}
