import "server-only";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db";
import { ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { safeEqual } from "./appAuth";
import { acknowledgeDisclosure } from "./espn/disclosure";
import { listFanLeagues } from "./espn/fanLeagues";
import { connectSeason } from "./espn/seasonConnect";
import { findSeasonLinkByEspn } from "./espn/seasonLinks";

/**
 * App Review's account (APE-398). Apple's reviewer can't get a magic link, so REVIEW_ACCOUNT_EMAIL
 * signs in with the fixed REVIEW_ACCOUNT_CODE instead, and lands in real ESPN test leagues, read and
 * written live through a dedicated ESPN test account. Only that one email ever takes a code: every
 * other address gets the magic link as always.
 */

/** Whether this is the review account's email. Always false when the account is off. */
export function isReviewAccount(email: string | null | undefined): boolean {
  const review = config.reviewAccount;
  return review !== null && typeof email === "string" && email.trim().toLowerCase() === review.email;
}

/** Whether `code` signs in `email`: only the review account's email, with its code. */
export function checkReviewCode(email: string, code: string): boolean {
  const review = config.reviewAccount;
  return review !== null && isReviewAccount(email) && safeEqual(code.trim(), review.code);
}

export type ReviewSetup = { ok: true; connected: string[]; kept: string[] } | { ok: false; error: string };

/**
 * Connects the ESPN test account's leagues to the reviewer: REVIEW_ESPN_LEAGUES, or every league it
 * has in its newest season. Leagues already linked are left alone, so it's safe at every sign-in, and
 * an account the reviewer deleted gets its leagues back the next time they sign in.
 */
export async function ensureReviewSetup(db: Db, userId: string, { fetchImpl, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<ReviewSetup> {
  const espn = config.reviewAccount?.espn;
  if (!espn) return { ok: false, error: "REVIEW_ESPN_S2 and REVIEW_ESPN_SWID aren't set" };
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return { ok: false, error: "In-season features are off (ESPN_CODE_KEY)" };
  const login = { espnS2: espn.espnS2, swid: espn.swid };

  const listed = await listFanLeagues(login, { fetchImpl });
  if (!listed.ok) return { ok: false, error: listed.reason === "auth" ? "ESPN refused the test account's login: refresh REVIEW_ESPN_S2 and REVIEW_ESPN_SWID" : "Couldn't reach ESPN" };
  const newest = Math.max(...listed.leagues.map((l) => l.season));
  const wanted = espn.leagueIds.length ? listed.leagues.filter((l) => espn.leagueIds.includes(l.espnLeagueId)) : listed.leagues.filter((l) => l.season === newest);
  if (!wanted.length) return { ok: false, error: "The test account has none of the leagues in REVIEW_ESPN_LEAGUES" };

  await acknowledgeDisclosure(db, userId, ESPN_DISCLOSURE_VERSION);
  const connected: string[] = [];
  const kept: string[] = [];
  for (const league of wanted) {
    if (await findSeasonLinkByEspn(db, userId, league.espnLeagueId, league.season)) {
      kept.push(league.espnLeagueId);
      continue;
    }
    const result = await connectSeason(
      db,
      config.espnCodeKey,
      userId,
      { ...login, espnLeagueId: league.espnLeagueId, season: league.season, consentVersion: ESPN_DISCLOSURE_VERSION },
      { fetchImpl, now },
    );
    if (!result.ok) return { ok: false, error: `ESPN league ${league.espnLeagueId}: ${result.error}` };
    connected.push(league.espnLeagueId);
  }
  return { ok: true, connected, kept };
}
