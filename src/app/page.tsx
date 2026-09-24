import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Landing } from "@/components/landing/Landing";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";

export const metadata: Metadata = {
  title: "Fantasy War Room — know who to pick",
  description:
    "Set up your fantasy football draft in one screen. Practice drafts of your league show who will still be there at your next pick, and a season pass adds an AI-written plan for your exact slot.",
};

/**
 * The hosted site's front door. A self-hosted install (cloud features off) has no accounts to sign
 * into and no one to sell to, so it keeps its old behavior and opens straight into the war room.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  // Render per request so feature flags reflect the runtime environment, not build-time env.
  await connection();

  // Anyone with a session has already made this decision. The query string rides along, so an
  // old link (e.g. a Stripe return to `/?checkout=success`) still lands where it was meant to.
  const user = publicFlags.cloudEnabled ? await getSessionUser() : null;
  if (!publicFlags.cloudEnabled || user) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
    }
    const qs = query.toString();
    // In season, a league following ESPN opens on its season page (10.7), unless the link was
    // meant for the draft room (anything with a query string).
    if (user && !qs && config.espnSeasonEnabled && mayUseSeason(config.espnSyncAllowlist, user.email)) {
      const [latest] = await listSeasonLinks(getDb(), user.userId);
      if (latest) redirect(`/season/${latest.leagueId}`);
    }
    redirect(qs ? `/draft?${qs}` : "/draft");
  }

  // Just signed out (see AccountMenu): the panel opens on its goodbye, rendered from the first paint.
  const farewell = (await searchParams).farewell === "1";
  return <Landing flags={publicFlags} farewell={farewell} />;
}
