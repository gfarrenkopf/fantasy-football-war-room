import "server-only";
import { after } from "next/server";
import type { Db } from "@/lib/db/types";
import type { ProjectionAccuracy } from "@/lib/season/accuracy";
import type { WeekFacts } from "@/lib/season/weekFacts";
import { projectionAccuracy, recordProjections } from "../seasonProjections";
import { keepWeeks, listWeeks } from "../seasonRecaps";
import { writeConsent } from "../seasonPrefs";
import { reconcileEspnDraft } from "./draftImport";
import { markSeasonViewed } from "./seasonLinks";
import { loadWeekView, type SeasonViewLoad } from "./seasonView";

/**
 * What a visit to a league's season does besides reading it, shared by the season page and the
 * iPhone app's season route (APE-379), so a user who only opens the app still feeds the recap
 * archive and ESPN's call.
 */

type Loaded = Extract<SeasonViewLoad, { kind: "ok" }>;

/**
 * The work a visit leaves for after the response, whether or not ESPN could be read: the league's
 * board brought up to ESPN's finished draft (APE-193, APE-325), ESPN's projections kept for game
 * day's "ESPN's call" (APE-229), and the weeks that are over put in the recap archive (APE-308).
 */
export function afterSeasonRead(db: Db, key: Buffer, userId: string, leagueId: string, load: SeasonViewLoad): void {
  after(() =>
    reconcileEspnDraft(db, key, userId, leagueId).catch((err: unknown) => console.warn(`[espn-season] draft backfill failed: ${(err as Error).message}`)),
  );
  if (load.kind !== "ok") return;
  const { view, result, previous } = load;
  // ESPN's projections as they stand; last week's too while its result or recap is up, so ESPN's
  // stat corrections still land (APE-251).
  for (const v of [view, result ?? previous].filter((v) => v !== undefined)) {
    after(() => recordProjections(db, leagueId, v).catch((err: unknown) => console.warn(`[espn-season] couldn't record projections: ${(err as Error).message}`)));
  }
  // The one on show, and a few older ones a visit fills in, so the archive builds up without one
  // visit reading the whole season.
  const shown = load.phase === "results" ? (result ?? view) : previous;
  const over = shown?.currentWeek ?? view.currentWeek - 1;
  after(() =>
    keepWeeks(db, leagueId, {
      season: view.season,
      throughWeek: over,
      loadWeek: (week) => (week === shown?.currentWeek ? Promise.resolve(shown) : loadWeekView(db, key, userId, leagueId, week)),
      limit: 3,
    }).catch((err: unknown) => console.warn(`[espn-season] couldn't keep the recaps: ${(err as Error).message}`)),
  );
}

export interface SeasonExtras {
  /** The ESPN write consent version the user has agreed to, or null. */
  consented: number | null;
  /** ESPN's calls on the week game day shows. */
  accuracy: ProjectionAccuracy;
  /** ESPN's calls on last week, between weeks. */
  previousAccuracy: ProjectionAccuracy | null;
  /** The league's kept weeks, for the recap archive. */
  kept: WeekFacts[];
}

/** What else a visit shows beside ESPN's league, read from the database; marks the league viewed. */
export async function seasonExtras(db: Db, userId: string, leagueId: string, { view, result, previous }: Loaded): Promise<SeasonExtras> {
  const [consented, , accuracy, previousAccuracy, kept] = await Promise.all([
    writeConsent(db, userId),
    markSeasonViewed(db, userId, leagueId),
    projectionAccuracy(db, leagueId, result ?? view),
    previous ? projectionAccuracy(db, leagueId, previous) : null,
    listWeeks(db, leagueId),
  ]);
  return { consented, accuracy, previousAccuracy, kept };
}
