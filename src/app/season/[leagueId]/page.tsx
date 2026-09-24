import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SeasonRoom, type SeasonProblem } from "@/components/season/SeasonRoom";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import type { PlayerProjections } from "@/lib/season/types";
import { buildSeasonView } from "@/lib/season/view";
import { getEspnProjections } from "@/lib/server/espn/projections";
import { loadSeason } from "@/lib/server/espn/seasonData";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { findLeague } from "@/lib/server/leagues";

export const metadata: Metadata = { title: "Your season · Fantasy War Room" };

/**
 * A league's in-season page (10.5): this week's recommended lineup, and trades (10.6). Everything
 * comes from ESPN, read on the server with the user's stored login; `?refresh=1` skips the cache.
 * Hosted only, and signed in only.
 */
export default async function Season({ params, searchParams }: PageProps<"/season/[leagueId]">) {
  await connection();
  if (!config.espnSeasonEnabled || !config.espnCodeKey) notFound();
  const { leagueId } = await params;
  const refresh = (await searchParams).refresh === "1";

  const user = await getSessionUser();
  if (!user) return <SeasonRoom flags={publicFlags} leagueId={leagueId} problem={{ kind: "signed-out" }} />;
  if (!mayUseSeason(config.espnSyncAllowlist, user.email)) notFound();
  const db = getDb();
  const league = await findLeague(db, user.userId, leagueId);
  if (!league) notFound();

  const load = await loadSeason(db, config.espnCodeKey, user.userId, leagueId, { refresh });
  if (load.kind !== "ok") return <SeasonRoom flags={publicFlags} leagueId={leagueId} leagueName={league.name} problem={load as SeasonProblem} />;

  const { league: season } = load;
  const ids = season.teams.flatMap((t) => t.roster.map((e) => e.playerId));
  // Only the projections fetch is allowed to fail: without it every player shows 0, with a note.
  let projections = new Map<number, PlayerProjections>();
  let projectionsMissing = false;
  try {
    projections = await getEspnProjections({ season: season.season, playerIds: ids, fromWeek: season.currentWeek, toWeek: season.finalWeek, ...(refresh ? { maxAgeMs: 0 } : {}) });
  } catch (err) {
    console.warn(`[espn-season] projections unavailable: ${(err as Error).message}`);
    projectionsMissing = true;
  }
  const view = buildSeasonView(season, load.espnTeamId, projections);

  return (
    <SeasonRoom
      flags={publicFlags}
      leagueId={leagueId}
      leagueName={league.name}
      view={view}
      fetchedAt={load.fetchedAt.toISOString()}
      stale={load.stale}
      projectionsMissing={projectionsMissing}
    />
  );
}
