import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after, connection } from "next/server";
import { SeasonRoom, type SeasonProblem } from "@/components/season/SeasonRoom";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { ESPN_LINEUP_WRITE_VERSION } from "@/lib/espn/disclosure";
import { getDb } from "@/lib/db";
import { seasonAiState } from "@/lib/server/ai/season";
import { backfillEspnDraft } from "@/lib/server/espn/draftImport";
import { listSeasonLinks, markSeasonViewed } from "@/lib/server/espn/seasonLinks";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { lineupWriteConsent, wantsSeasonEmails } from "@/lib/server/seasonPrefs";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { findLeague } from "@/lib/server/leagues";

export const metadata: Metadata = { title: "Your season · Fantasy War Room" };

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
  if (load.kind !== "ok") return <SeasonRoom flags={publicFlags} leagueId={leagueId} leagueName={league.name} leagues={leagues} problem={load as SeasonProblem} />;
  const { view } = load;
  const [ai, emails, writeConsent] = await Promise.all([
    seasonAiState(db, user, league, view),
    // Only offered when the Sunday job can send email at all.
    config.seasonJobEnabled && config.emailAuthEnabled ? wantsSeasonEmails(db, user.userId) : null,
    lineupWriteConsent(db, user.userId),
    markSeasonViewed(db, user.userId, leagueId),
  ]);

  return (
    <SeasonRoom
      flags={publicFlags}
      leagueId={leagueId}
      leagueName={league.name}
      leagues={leagues}
      view={view}
      fetchedAt={load.fetchedAt.toISOString()}
      stale={load.stale}
      projectionsMissing={load.projectionsMissing}
      ai={ai}
      checkout={checkout}
      seasonEmails={emails}
      writeConsented={(writeConsent ?? 0) >= ESPN_LINEUP_WRITE_VERSION}
    />
  );
}
