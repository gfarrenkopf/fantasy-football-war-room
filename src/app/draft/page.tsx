import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { WarRoom } from "@/components/draft/WarRoom";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";

export const metadata: Metadata = { title: "Fantasy War Room" };

/**
 * A first sign-in always lands here (Auth.js's pages.newUser), with where it was headed as
 * `callbackUrl`. Someone who signed up mid-way through connecting their ESPN season goes back to
 * finish it; anyone else stays for the welcome.
 */
function unfinishedSeasonConnect(params: Record<string, string | string[] | undefined>): string | null {
  const callback = params.welcome === "new" && typeof params.callbackUrl === "string" ? params.callbackUrl : null;
  if (!callback) return null;
  try {
    const url = new URL(callback, "http://localhost");
    return url.pathname === "/espn/season" && url.searchParams.has("claim") ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

export default async function Draft({ searchParams }: PageProps<"/draft">) {
  // Render per request so feature flags reflect the runtime environment, not build-time env.
  await connection();
  const resume = unfinishedSeasonConnect(await searchParams);
  if (resume) redirect(resume);

  const user = await getSessionUser();
  // Leagues with a season page (10.7), so the draft room can link to it.
  const season = user && config.espnSeasonEnabled && mayUseSeason(config.espnSyncAllowlist, user.email);
  const seasonLeagueIds = season ? (await listSeasonLinks(getDb(), user.userId)).map((l) => l.leagueId) : [];
  return <WarRoom flags={publicFlags} user={user} seasonLeagueIds={seasonLeagueIds} />;
}
