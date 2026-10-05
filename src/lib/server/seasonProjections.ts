import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { seasonProjections } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import type { PlayerCall, ProjectionAccuracy, ProjectionCall } from "@/lib/season/accuracy";
import { matchupDecided } from "@/lib/season/gameday";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";

/**
 * ESPN's pre-game projections, kept for game day's "ESPN's call" (APE-229). Each read of a league
 * (the season page, the Sunday job, the early-kickoff job) records what it sees:
 * - before kickoff, the projection, replacing the last one;
 * - once the game is on, nothing new, so the pre-game number stays;
 * - once it's final, the points scored.
 * A team's matchup projection is pre-game until any of its starters kicks off, and final once every
 * starter on both sides is.
 */

type Stage = "pre" | "live" | "final";

interface Row {
  subject: string;
  projected: number;
  actual: number | null;
  stage: Stage;
}

const playerStage = (p: ViewPlayer): Stage | null => {
  if (!p.game) return null;
  if (p.game.state === "post") return "final";
  return p.game.state === "pre" && p.actual === null ? "pre" : "live";
};

const starters = (roster: readonly ViewPlayer[]) => roster.filter((p) => p.slot !== "BN" && p.slot !== "IR");

export async function recordProjections(db: Db, leagueId: string, view: SeasonView, now = new Date()): Promise<void> {
  const rosterOf = (teamId: number) => view.teams.find((t) => t.id === teamId)?.roster ?? [];
  const rows: Row[] = [];
  for (const p of rosterOf(view.myTeamId)) {
    const stage = p.slot === "IR" ? null : playerStage(p);
    if (stage) rows.push({ subject: `player:${p.playerId}`, projected: p.points, actual: stage === "final" ? (p.actual ?? 0) : null, stage });
  }
  if (view.matchup) {
    const decided = matchupDecided(view);
    for (const side of [view.matchup.me, view.matchup.them]) {
      const kicked = starters(rosterOf(side.teamId)).some((p) => playerStage(p) !== "pre" && playerStage(p) !== null);
      const stage: Stage = decided ? "final" : kicked ? "live" : "pre";
      rows.push({ subject: `team:${side.teamId}`, projected: side.projected, actual: decided ? side.points : null, stage });
    }
  }
  const values = (stage: Stage) =>
    rows.filter((r) => r.stage === stage).map((r) => ({ leagueId, season: view.season, week: view.currentWeek, subject: r.subject, projected: r.projected, actual: r.actual, capturedAt: now, settledAt: stage === "final" ? now : null }));
  const target = [seasonProjections.leagueId, seasonProjections.season, seasonProjections.week, seasonProjections.subject];

  const pre = values("pre");
  if (pre.length)
    await db
      .insert(seasonProjections)
      .values(pre)
      .onConflictDoUpdate({ target, set: { projected: sql`excluded.projected`, capturedAt: now }, setWhere: isNull(seasonProjections.settledAt) });
  // Seen only once the game was on: the projection then is better than none, but never replaces a pre-game one.
  const live = values("live");
  if (live.length) await db.insert(seasonProjections).values(live).onConflictDoNothing({ target });
  // ESPN corrects stats for days after a game, so a final row keeps taking the latest points.
  const final = values("final");
  if (final.length)
    await db
      .insert(seasonProjections)
      .values(final)
      .onConflictDoUpdate({ target, set: { actual: sql`excluded.actual`, settledAt: sql`coalesce(${seasonProjections.settledAt}, excluded.settled_at)` } });
}

/** This week's calls for the user's matchup and players, and how close ESPN has come on their team this season. */
export async function projectionAccuracy(db: Db, leagueId: string, view: SeasonView): Promise<ProjectionAccuracy> {
  const here = and(eq(seasonProjections.leagueId, leagueId), eq(seasonProjections.season, view.season));
  const [week, past] = await Promise.all([
    db
      .select({ subject: seasonProjections.subject, projected: seasonProjections.projected, actual: seasonProjections.actual })
      .from(seasonProjections)
      .where(and(here, eq(seasonProjections.week, view.currentWeek))),
    db
      .select({ projected: seasonProjections.projected, actual: seasonProjections.actual })
      .from(seasonProjections)
      .where(and(here, lt(seasonProjections.week, view.currentWeek), eq(seasonProjections.subject, `team:${view.myTeamId}`), isNotNull(seasonProjections.actual))),
  ]);
  const call = (subject: string): ProjectionCall | null => {
    const row = week.find((r) => r.subject === subject);
    return row ? { projected: row.projected, actual: row.actual } : null;
  };
  const players: PlayerCall[] = week.filter((r) => r.subject.startsWith("player:")).map((r) => ({ playerId: Number(r.subject.slice(7)), projected: r.projected, actual: r.actual }));
  const misses = past.map((r) => (r.actual ?? 0) - r.projected);
  return {
    me: call(`team:${view.myTeamId}`),
    them: view.matchup ? call(`team:${view.matchup.them.teamId}`) : null,
    players,
    season: misses.length
      ? {
          weeks: misses.length,
          meanMiss: round(misses.reduce((sum, m) => sum + Math.abs(m), 0) / misses.length),
          meanBias: round(misses.reduce((sum, m) => sum + m, 0) / misses.length),
        }
      : null,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
