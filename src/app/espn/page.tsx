import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BridgeInstall } from "@/components/espn/BridgeInstall";
import { config } from "@/lib/config";

export const metadata: Metadata = { title: "The War Room bookmark · Fantasy War Room" };

/** How to install the War Room bookmark, on a computer or a phone, and use it to connect the season or sync the draft. */
export default async function EspnSetup() {
  await connection();
  if (!config.espnSyncEnabled) notFound();
  return <BridgeInstall season={config.espnSeasonEnabled} />;
}
