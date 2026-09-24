import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SeasonRoom, type SeasonProblem } from "@/components/season/SeasonRoom";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { seasonAiState } from "@/lib/server/ai/season";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { findLeague } from "@/lib/server/leagues";

export const metadata: Metadata = { title: "Your season · Fantasy War Room" };

/**
 * A league's in-season page (10.5): this week's recommended lineup, and trades (10.6), plus in-season
 * AI when it's on (Epic 11). Everything
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
  const league = await findLeague(db, user.userId, leagueId);
  if (!league) notFound();

  const load = await loadSeasonView(db, config.espnCodeKey, user.userId, leagueId, { refresh });
  if (load.kind !== "ok") return <SeasonRoom flags={publicFlags} leagueId={leagueId} leagueName={league.name} problem={load as SeasonProblem} />;
  const { view } = load;
  const ai = await seasonAiState(db, user, league, view);

  return (
    <SeasonRoom
      flags={publicFlags}
      leagueId={leagueId}
      leagueName={league.name}
      view={view}
      fetchedAt={load.fetchedAt.toISOString()}
      stale={load.stale}
      projectionsMissing={load.projectionsMissing}
      ai={ai}
      checkout={checkout}
    />
  );
}
