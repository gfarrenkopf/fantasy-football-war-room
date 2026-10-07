import { and, asc, desc, eq, isNull, like } from "drizzle-orm";
import { seasonProjections, seasonRecaps } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { weekFinal } from "@/lib/season/gameday";
import type { SeasonView } from "@/lib/season/view";
import { toWeekFacts, WEEK_FACTS_VERSION, type WeekFacts } from "@/lib/season/weekFacts";
import type { SeasonViewLoad } from "./espn/seasonView";
import { activeLeagues, jobError } from "./seasonJobs";

/**
 * The weekly recap archive (APE-308): each finished week of a league, kept as its facts in
 * season_recaps. The season page saves the weeks it shows and fills in a few it's missing on each
 * visit; the Wednesday job (src/app/api/internal/season/recaps) saves every league's last week once
 * ESPN's stat corrections are in, and settles it.
 */

/**
 * Keeps a finished week's facts. A settled week is only rewritten by another settling save, so a
 * page showing a stale read can't undo the Wednesday job's. ESPN's pre-kickoff calls on the user's
 * players come from season_projections.
 */
export async function saveWeek(
  db: Db,
  leagueId: string,
  view: SeasonView,
  { settle = false, now = new Date() }: { settle?: boolean; now?: Date } = {},
): Promise<void> {
  const rows = await db
    .select({ subject: seasonProjections.subject, projected: seasonProjections.projected })
    .from(seasonProjections)
    .where(
      and(
        eq(seasonProjections.leagueId, leagueId),
        eq(seasonProjections.season, view.season),
        eq(seasonProjections.week, view.currentWeek),
        like(seasonProjections.subject, "player:%"),
      ),
    );
  const calls = new Map(rows.map((r) => [Number(r.subject.slice(7)), r.projected]));
  const facts = toWeekFacts(view, calls);
  await db
    .insert(seasonRecaps)
    .values({ leagueId, season: view.season, week: view.currentWeek, version: WEEK_FACTS_VERSION, facts, savedAt: now, settledAt: settle ? now : null })
    .onConflictDoUpdate({
      target: [seasonRecaps.leagueId, seasonRecaps.season, seasonRecaps.week],
      set: { version: WEEK_FACTS_VERSION, facts, savedAt: now, ...(settle ? { settledAt: now } : {}) },
      ...(settle ? {} : { setWhere: isNull(seasonRecaps.settledAt) }),
    });
}

/** A league's kept weeks this War Room can read: the newest season first, each season's weeks in order. */
export async function listWeeks(db: Db, leagueId: string): Promise<WeekFacts[]> {
  const rows = await db
    .select({ facts: seasonRecaps.facts, version: seasonRecaps.version })
    .from(seasonRecaps)
    .where(eq(seasonRecaps.leagueId, leagueId))
    .orderBy(desc(seasonRecaps.season), asc(seasonRecaps.week));
  return rows.flatMap((r) => (r.version === WEEK_FACTS_VERSION ? [r.facts] : []));
}

export interface KeepOptions {
  season: number;
  /** The last week that's over. */
  throughWeek: number;
  /** A week's view from ESPN; null when ESPN doesn't have it. */
  loadWeek(week: number): Promise<SeasonView | null>;
  /** Settle what's saved (the Wednesday job), and resave weeks not yet settled. */
  settle?: boolean;
  /** At most this many weeks read from ESPN in one go. */
  limit?: number;
  now?: Date;
}

/**
 * Saves the league's finished weeks that aren't kept yet (or, settling, aren't settled yet), newest
 * first, up to `limit`. A week ESPN can't read is skipped and counted.
 */
export async function keepWeeks(
  db: Db,
  leagueId: string,
  { season, throughWeek, loadWeek, settle = false, limit = Infinity, now = new Date() }: KeepOptions,
): Promise<{ saved: number; failed: number }> {
  const kept = await db
    .select({ week: seasonRecaps.week, settledAt: seasonRecaps.settledAt, version: seasonRecaps.version })
    .from(seasonRecaps)
    .where(and(eq(seasonRecaps.leagueId, leagueId), eq(seasonRecaps.season, season)));
  const done = new Set(kept.filter((k) => k.version === WEEK_FACTS_VERSION && (!settle || k.settledAt)).map((k) => k.week));
  const todo = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => throughWeek - i).filter((w) => !done.has(w));
  let saved = 0;
  let failed = 0;
  for (const week of todo.slice(0, limit)) {
    try {
      const view = await loadWeek(week);
      if (!view || !weekFinal(view)) continue;
      await saveWeek(db, leagueId, view, { settle, now });
      saved++;
    } catch (err) {
      console.warn(`[season-recaps] couldn't keep week ${week} of ${leagueId}: ${(err as Error).message}`);
      failed++;
    }
  }
  return { saved, failed };
}

/** Weeks the Wednesday job reads from ESPN per league: last week, plus a few older ones still unsettled. */
const JOB_WEEKS = 4;

export interface RecapsDeps {
  /** The league's season view, fresh from ESPN: says which week ESPN is on, and whether the login works. */
  loadView(userId: string, leagueId: string): Promise<SeasonViewLoad>;
  loadWeek(userId: string, leagueId: string, week: number): Promise<SeasonView | null>;
  now?: Date;
}

export interface RecapsSummary {
  dryRun: boolean;
  /** Connected leagues, idle ones included. */
  leagues: number;
  /** Skipped: ESPN couldn't be read with the user's login, or the league no longer follows one. */
  notConnected: number;
  /** Weeks saved and settled (or, in a dry run, leagues that would have been read). */
  saved: number;
  failed: number;
}

/**
 * The Wednesday recap job (APE-308). For every connected league it saves and settles last week,
 * with ESPN's stat corrections in, and any earlier week still unsettled or missing. Reruns are safe:
 * settled weeks aren't read again.
 */
export async function runRecapsJob(db: Db, deps: RecapsDeps, { dryRun = false }: { dryRun?: boolean } = {}): Promise<RecapsSummary> {
  const now = deps.now ?? new Date();
  const summary: RecapsSummary = { dryRun, leagues: 0, notConnected: 0, saved: 0, failed: 0 };
  const { total, byUser } = await activeLeagues(db, now, { includeIdle: true });
  summary.leagues = total;
  for (const list of byUser.values()) {
    for (const league of list) {
      try {
        const load = await deps.loadView(league.userId, league.leagueId);
        if (load.kind !== "ok") {
          summary.notConnected++;
          continue;
        }
        const { view } = load;
        if (dryRun) {
          summary.saved++;
          continue;
        }
        const kept = await keepWeeks(db, league.leagueId, {
          season: view.season,
          throughWeek: view.currentWeek - 1,
          loadWeek: (week) => deps.loadWeek(league.userId, league.leagueId, week),
          settle: true,
          limit: JOB_WEEKS,
          now,
        });
        summary.saved += kept.saved;
        summary.failed += kept.failed;
      } catch (err) {
        summary.failed++;
        jobError("recaps", (err as Error).message, { leagueId: league.leagueId });
      }
    }
  }
  return summary;
}
