import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { withUser } from "@/lib/server/api";
import { acknowledgeDisclosure, hasAcknowledgedDisclosure } from "@/lib/server/espn/disclosure";
import { dropClaim, openClaim } from "@/lib/server/espn/loginClaims";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { connectSeason } from "@/lib/server/espn/seasonConnect";
import { empty, error, isSameOrigin, json, readJson } from "@/lib/server/http";

const CLAIM_CODE = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * POST /api/espn/season/claim { claim, acknowledged? } → { leagueId, created }
 *
 * The season page (src/app/espn/season/page.tsx) claiming the ESPN login the bridge handed off
 * (APE-297) for the signed-in user, then connecting the season with it (connectSeason()). One tap
 * on the page, not on load, so a link can't connect someone else's ESPN login to a user's account
 * behind their back. 428 until the user has agreed to the current ESPN disclosure, which
 * `acknowledged` does: asked here, once per account, and the same consent as pairing a draft
 * (APE-332). The claim is used up unless ESPN couldn't be reached, so the user can retry that; 410
 * when it's unknown or expired, so the page can send them back to the bookmark.
 */
export const POST = withUser<unknown>(async (request, _ctx, { db, userId, email }) => {
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = (read.body ?? {}) as { claim?: unknown; acknowledged?: unknown };
  const code = body.claim;
  if (typeof code !== "string" || !CLAIM_CODE.test(code)) return error(400, "Invalid claim");
  if (!(await hasAcknowledgedDisclosure(db, userId, ESPN_DISCLOSURE_VERSION))) {
    if (body.acknowledged !== ESPN_DISCLOSURE_VERSION) return json(428, { needsDisclosure: ESPN_DISCLOSURE_VERSION });
  }
  const claim = await openClaim(db, config.espnCodeKey, code);
  if (!claim) return error(410, "That link has expired. Tap the Draft Room bookmark on your ESPN league page again.");
  if (body.acknowledged === ESPN_DISCLOSURE_VERSION) await acknowledgeDisclosure(db, userId, ESPN_DISCLOSURE_VERSION);
  const result = await connectSeason(db, config.espnCodeKey, userId, {
    espnLeagueId: claim.espnLeagueId,
    season: claim.season,
    consentVersion: ESPN_DISCLOSURE_VERSION,
    ...claim.login,
  });
  if (result.ok || result.status !== 503) await dropClaim(db, code);
  if (!result.ok) return json(result.status, { error: result.error, ...(result.seasonVersion ? { seasonVersion: result.seasonVersion } : {}) });
  return json(200, { leagueId: result.leagueId, created: result.created });
});

/**
 * DELETE /api/espn/season/claim { claim } → 204
 *
 * "Not now" on the season page: the login the bridge parked is deleted at once rather than left to
 * expire. No sign-in needed, since whoever holds the code is whoever the bridge gave it to, and
 * deleting it only ever takes a login away.
 */
export async function DELETE(request: Request) {
  if (!config.espnSeasonEnabled) return error(404, "Not found");
  if (!isSameOrigin(request)) return error(403, "Forbidden");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const code = (read.body as { claim?: unknown } | null)?.claim;
  if (typeof code !== "string" || !CLAIM_CODE.test(code)) return error(400, "Invalid claim");
  await dropClaim(getDb(), code);
  return empty(204);
}
