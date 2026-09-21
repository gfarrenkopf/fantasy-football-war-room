import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BridgeInstall } from "@/components/espn/BridgeInstall";
import { config } from "@/lib/config";

export const metadata: Metadata = { title: "Sync your ESPN draft · Fantasy War Room" };

/** How to set up ESPN live sync: install the War Room bookmark, then click it in the ESPN draft room. */
export default async function EspnSetup() {
  await connection();
  if (!config.espnSyncEnabled) notFound();
  return <BridgeInstall />;
}
