import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BridgeInstall } from "@/components/espn/BridgeInstall";
import { getSessionUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { espnLeaguePage } from "@/lib/espn/pages";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";

export const metadata: Metadata = { title: "Your ESPN bookmark · Draft Room" };

/**
 * How to install the War Room bookmark, on a computer or a phone, and use it to connect the season or
 * sync the draft. A signed-in user's connected leagues are linked straight to ESPN (APE-303), so
 * reconnecting from a phone doesn't start with finding the league.
 */
export default async function EspnSetup() {
  await connection();
  if (!config.espnSyncEnabled) notFound();
  const user = config.espnSeasonEnabled ? await getSessionUser() : null;
  const links = user && mayUseSeason(config.espnSyncAllowlist, user.email) ? await listSeasonLinks(getDb(), user.userId) : [];
  return <BridgeInstall season={config.espnSeasonEnabled} leagues={links.map((l) => ({ name: l.name, url: espnLeaguePage(l) }))} />;
}
