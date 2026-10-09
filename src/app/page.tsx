import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Landing } from "@/components/landing/Landing";
import { SeasonLanding } from "@/components/landing/season/SeasonLanding";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { seasonSample } from "@/lib/landing/sample";
import { landingMode } from "@/lib/landing/seasonSample";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";

const DRAFT_METADATA: Metadata = {
  title: "Draft Room — know who to pick",
  description:
    "Set up your fantasy football draft in one screen. Practice drafts of your league show who will still be there at your next pick, and a season pass adds an AI-written plan for your exact slot.",
};

const SEASON_METADATA: Metadata = {
  title: "Draft Room — start the team that wins",
  description:
    "Draft Room sets your best ESPN fantasy football lineup every week, finds the waiver pickups and trades that help, and tells you why.",
};

/** Which face the door shows (APE-340): the draft page, or from week 1 to the fantasy final, the season page. */
const mode = () => landingMode(config.landingMode, config.espnSeasonEnabled, Date.now(), seasonSample.window);

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return mode() === "season" ? SEASON_METADATA : DRAFT_METADATA;
}

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
  return mode() === "season" ? (
    <SeasonLanding flags={publicFlags} sample={seasonSample} farewell={farewell} />
  ) : (
    <Landing flags={publicFlags} farewell={farewell} />
  );
}
