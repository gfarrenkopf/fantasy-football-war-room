import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after, connection } from "next/server";
import { espnLeaguePage } from "@/lib/espn/pages";
import { SeasonRoom, type SeasonProblem } from "@/components/season/SeasonRoom";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { getDb } from "@/lib/db";
import { seasonAiState } from "@/lib/server/ai/season";
import { backfillEspnDraft } from "@/lib/server/espn/draftImport";
import { listSeasonLinks, markSeasonViewed } from "@/lib/server/espn/seasonLinks";
import { loadSeasonView, loadWeekView } from "@/lib/server/espn/seasonView";
import { projectionAccuracy, recordProjections } from "@/lib/server/seasonProjections";
import { keepWeeks, listWeeks } from "@/lib/server/seasonRecaps";
import { archiveWeek } from "@/lib/season/leagueRecap";
import { wantsSeasonEmails, writeConsent } from "@/lib/server/seasonPrefs";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { findLeague } from "@/lib/server/leagues";

export const metadata: Metadata = { title: "Your season · Draft Room" };

/**
 * A league's in-season page (10.5): this week's recommended lineup, and trades (10.6), plus in-season
 * AI when it's on (Epic 11), and setting the lineup on ESPN (12.1). Everything
 * comes from ESPN, read on the server with the user's stored login; `?refresh=1` skips the cache.
 * Hosted only, and signed in only.
 */
export default async function Season({ params, searchParams }: PageProps<"/season/[leagueId]">) {
  await connection();
  if (!config.espnSeasonEnabled || !config.espnCodeKey) notFound();
  const { leagueId } = await params;
  const query = await searchParams;
  const refresh = query.refresh === "1";
  const checkout = query.checkout === "success" || query.checkout === "cancel" ? query.checkout : null;

  const user = await getSessionUser();
  if (!user) return <SeasonRoom flags={publicFlags} leagueId={leagueId} problem={{ kind: "signed-out" }} />;
  if (!mayUseSeason(config.espnSyncAllowlist, user.email)) notFound();
  const db = getDb();
  const [league, links] = await Promise.all([findLeague(db, user.userId, leagueId), listSeasonLinks(db, user.userId)]);
  if (!league) notFound();
  // Every league the user follows on ESPN, for the switcher; this one even if its link is gone.
  const leagues = links.map((l) => ({ id: l.leagueId, name: l.name }));
  if (!leagues.some((l) => l.id === leagueId)) leagues.unshift({ id: leagueId, name: league.name });

  const key = config.espnCodeKey;
  // A league connected before its draft could be imported (APE-193) gets its board now, after the
  // page is sent; the draft room reads it from the server next time it opens.
  after(() =>
    backfillEspnDraft(db, key, user.userId, leagueId).catch((err: unknown) => console.warn(`[espn-season] draft backfill failed: ${(err as Error).message}`)),
  );
  const load = await loadSeasonView(db, key, user.userId, leagueId, { refresh });
  if (load.kind !== "ok") {
    // Reconnecting starts on the user's ESPN league page (APE-301).
    const link = links.find((l) => l.leagueId === leagueId);
    const espnUrl = link ? espnLeaguePage(link) : undefined;
    return <SeasonRoom flags={publicFlags} leagueId={leagueId} leagueName={league.name} leagues={leagues} problem={load as SeasonProblem} espnUrl={espnUrl} />;
  }
  const { view, result, previous } = load;
  // ESPN's projections as they stand, kept for game day's "ESPN's call" (APE-229); last week's too
  // while its result or recap is up, so ESPN's stat corrections still land (APE-251).
  for (const v of [view, result ?? previous].filter((v) => v !== undefined)) {
    after(() => recordProjections(db, leagueId, v).catch((err: unknown) => console.warn(`[espn-season] couldn't record projections: ${(err as Error).message}`)));
  }
  // The weeks that are over go into the recap archive (APE-308): the one on show, and a few older
  // ones a visit fills in, so the archive builds up without one page view reading the whole season.
  const shown = load.phase === "results" ? (result ?? view) : previous;
  const over = shown?.currentWeek ?? view.currentWeek - 1;
  after(() =>
    keepWeeks(db, leagueId, {
      season: view.season,
      throughWeek: over,
      loadWeek: (week) => (week === shown?.currentWeek ? Promise.resolve(shown) : loadWeekView(db, key, user.userId, leagueId, week)),
      limit: 3,
    }).catch((err: unknown) => console.warn(`[espn-season] couldn't keep the recaps: ${(err as Error).message}`)),
  );
  const [ai, emails, consented, , accuracy, previousAccuracy, kept] = await Promise.all([
    seasonAiState(db, user, league, view),
    // Only offered when the Sunday job can send email at all.
    config.seasonJobEnabled && config.emailAuthEnabled ? wantsSeasonEmails(db, user.userId) : null,
    writeConsent(db, user.userId),
    markSeasonViewed(db, user.userId, leagueId),
    projectionAccuracy(db, leagueId, result ?? view),
    previous ? projectionAccuracy(db, leagueId, previous) : null,
    listWeeks(db, leagueId),
  ]);

  return (
    <SeasonRoom
      flags={publicFlags}
      leagueId={leagueId}
      leagueName={league.name}
      leagues={leagues}
      view={view}
      result={result}
      previous={previous ? { view: previous, accuracy: previousAccuracy } : undefined}
      fetchedAt={load.fetchedAt.toISOString()}
      stale={load.stale}
      projectionsMissing={load.projectionsMissing}
      ai={ai}
      checkout={checkout}
      seasonEmails={emails}
      writeConsented={(consented ?? 0) >= ESPN_WRITE_VERSION}
      phase={load.phase}
      accuracy={accuracy}
      archive={kept.map(archiveWeek)}
    />
  );
}
