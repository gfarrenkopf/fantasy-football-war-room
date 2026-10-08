import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EspnSeasonConnect } from "@/components/espn/EspnSeasonConnect";
import { getSessionUser } from "@/lib/auth";
import { config, publicFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { hasAcknowledgedDisclosure } from "@/lib/server/espn/disclosure";
import { peekClaim } from "@/lib/server/espn/loginClaims";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";

export const metadata: Metadata = { title: "Connect your season · Draft Room" };

/**
 * Where the ESPN bridge sends its tab from a league page (10.3, APE-298), with a one-time claim for
 * the login it just parked. First-party, so the Draft Room session works here: the user signs in if
 * they need to, agrees to the ESPN disclosure if their account hasn't yet (APE-332), and the claim
 * is posted to /api/espn/season/claim. Then this tab becomes the league's season page.
 */
export default async function SeasonConnect({ searchParams }: PageProps<"/espn/season">) {
  await connection();
  if (!config.espnSeasonEnabled) notFound();
  const params = await searchParams;
  const code = (Array.isArray(params.claim) ? params.claim[0] : params.claim) ?? "";
  const scope = code ? await peekClaim(getDb(), code) : null;
  const claim = !code ? null : scope ? { code, espnLeagueId: scope.espnLeagueId, season: scope.season } : "expired";
  const user = await getSessionUser();
  const acknowledged = user ? await hasAcknowledgedDisclosure(getDb(), user.userId, ESPN_DISCLOSURE_VERSION) : false;
  return (
    <EspnSeasonConnect
      flags={publicFlags}
      signedIn={!!user}
      allowed={!user || mayUseSeason(config.espnSyncAllowlist, user.email)}
      acknowledged={acknowledged}
      claim={claim}
    />
  );
}
