import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EspnPair } from "@/components/espn/EspnPair";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { lastPairedLeague } from "@/lib/server/espn/bridgeTokens";
import { listLeagues } from "@/lib/server/leagues";

export const metadata: Metadata = { title: "Connect your ESPN draft · Fantasy War Room" };

/**
 * The popup the ESPN bridge opens (public/espn-bridge.js). First-party, so the War Room session
 * works here: it picks the war room league to sync into, mints a bridge token, and hands it back to
 * the bridge in the ESPN tab.
 */
export default async function Pair({ searchParams }: PageProps<"/espn/pair">) {
  await connection();
  if (!config.espnSyncEnabled) notFound();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const espn = { leagueId: one(params.league), teamId: Number(one(params.team)) || 0, season: Number(one(params.season)) || 0 };

  const user = await getSessionUser();
  const db = user ? getDb() : null;
  const leagues = db && user ? await listLeagues(db, user.userId) : [];
  const remembered = db && user && espn.leagueId ? await lastPairedLeague(db, user.userId, espn.leagueId) : null;
  const newest = [...leagues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null;

  return (
    <EspnPair
      flags={publicFlags}
      signedIn={!!user}
      espn={espn}
      leagues={leagues.map((l) => ({ id: l.id, name: l.name, teams: l.settings.teams }))}
      defaultLeagueId={remembered && leagues.some((l) => l.id === remembered) ? remembered : newest}
    />
  );
}
