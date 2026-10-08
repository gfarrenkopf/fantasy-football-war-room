import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SetupWizard, type DraftTarget } from "@/components/espn/SetupWizard";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { espnDraftPage, espnLeaguePage } from "@/lib/espn/pages";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";
import { findLeague } from "@/lib/server/leagues";

export const metadata: Metadata = { title: "Connect ESPN · Draft Room" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Setting up the Draft Room bookmark and connecting ESPN with it (APE-333): a step at a time for a
 * first-timer on this device, straight to connecting for anyone whose bookmark already works here.
 * `?for=season|draft` says what they came to do, and `&league=` which Draft Room league's draft, so
 * its ESPN draft can be opened directly. A signed-in user's connected leagues are linked straight to
 * ESPN (APE-303, APE-335), so reconnecting from a phone doesn't start with finding the league.
 */
export default async function EspnSetup({ searchParams }: PageProps<"/espn">) {
  await connection();
  if (!config.espnSyncEnabled) notFound();
  const params = await searchParams;
  const user = await getSessionUser();
  const season = config.espnSeasonEnabled && (!user || mayUseSeason(config.espnSyncAllowlist, user.email));
  const intent = one(params.for) === "draft" || !season ? "draft" : "season";
  const links = user && season ? await listSeasonLinks(getDb(), user.userId) : [];
  const leagueId = one(params.league);
  const row = user && leagueId ? await findLeague(getDb(), user.userId, leagueId) : null;
  const draft: DraftTarget | null = row && !row.deletedAt ? { name: row.name, url: row.espn ? espnDraftPage(row.espn) : null } : null;
  return (
    <SetupWizard
      flags={publicFlags}
      signedIn={!!user}
      season={season}
      intent={intent}
      leagues={links.map((l) => ({ name: l.name, season: l.season, url: espnLeaguePage(l) }))}
      draft={draft}
    />
  );
}
