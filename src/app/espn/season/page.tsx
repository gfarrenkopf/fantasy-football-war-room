import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EspnSeasonConnect } from "@/components/espn/EspnSeasonConnect";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";

export const metadata: Metadata = { title: "Connect your season · Fantasy War Room" };

/**
 * The popup the ESPN bridge opens from a league page (10.3). First-party, so the War Room session
 * works here: the user agrees to hand over their ESPN login, the bridge passes it to this window,
 * and it's posted to /api/espn/season/connect. Then this window becomes the league's season page.
 */
export default async function SeasonConnect({ searchParams }: PageProps<"/espn/season">) {
  await connection();
  if (!config.espnSeasonEnabled) notFound();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const espn = { leagueId: one(params.league), season: Number(one(params.season)) || 0 };
  const user = await getSessionUser();
  return (
    <EspnSeasonConnect
      flags={publicFlags}
      signedIn={!!user}
      allowed={!user || mayUseSeason(config.espnSyncAllowlist, user.email)}
      espn={espn}
    />
  );
}
