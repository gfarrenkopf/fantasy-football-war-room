import type { Metadata } from "next";
import { connection } from "next/server";
import { WarRoom } from "@/components/draft/WarRoom";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";

export const metadata: Metadata = { title: "Fantasy War Room" };

export default async function Draft() {
  // Render per request so feature flags reflect the runtime environment, not build-time env.
  await connection();

  const user = await getSessionUser();
  // Leagues with a season page (10.7), so the draft room can link to it.
  const season = user && config.espnSeasonEnabled && mayUseSeason(config.espnSyncAllowlist, user.email);
  const seasonLeagueIds = season ? (await listSeasonLinks(getDb(), user.userId)).map((l) => l.leagueId) : [];
  return <WarRoom flags={publicFlags} user={user} seasonLeagueIds={seasonLeagueIds} />;
}
