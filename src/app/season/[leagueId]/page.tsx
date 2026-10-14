import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { espnLeaguePage } from "@/lib/espn/pages";
import { SeasonRoom, type SeasonProblem } from "@/components/season/SeasonRoom";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { getDb } from "@/lib/db";
import { seasonAiState } from "@/lib/server/ai/season";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { afterSeasonRead, seasonExtras } from "@/lib/server/espn/seasonVisit";
import { archiveWeek } from "@/lib/season/leagueRecap";
import { loadShell } from "@/lib/server/shell";
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
  const [league, links, shell] = await Promise.all([findLeague(db, user.userId, leagueId), listSeasonLinks(db, user.userId), loadShell(db, user)]);
  if (!league) notFound();

  const key = config.espnCodeKey;
  const load = await loadSeasonView(db, key, user.userId, leagueId, { refresh });
  afterSeasonRead(db, key, user.userId, leagueId, load);
  if (load.kind !== "ok") {
    // Reconnecting starts on the user's ESPN league page (APE-301).
    const link = links.find((l) => l.leagueId === leagueId);
    const espnUrl = link ? espnLeaguePage(link) : undefined;
    return <SeasonRoom flags={publicFlags} user={user} leagueId={leagueId} leagueName={league.name} shell={shell} problem={load as SeasonProblem} espnUrl={espnUrl} />;
  }
  const { view, result, previous } = load;
  const [ai, { consented, accuracy, previousAccuracy, kept }] = await Promise.all([seasonAiState(db, user, league, view), seasonExtras(db, user.userId, leagueId, load)]);

  return (
    <SeasonRoom
      flags={publicFlags}
      user={user}
      leagueId={leagueId}
      leagueName={league.name}
      shell={shell}
      view={view}
      result={result}
      previous={previous ? { view: previous, accuracy: previousAccuracy } : undefined}
      fetchedAt={load.fetchedAt.toISOString()}
      stale={load.stale}
      projectionsMissing={load.projectionsMissing}
      ai={ai}
      checkout={checkout}
      writeConsented={(consented ?? 0) >= ESPN_WRITE_VERSION}
      phase={load.phase}
      accuracy={accuracy}
      archive={kept.map(archiveWeek)}
    />
  );
}
