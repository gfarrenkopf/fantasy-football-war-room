import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { dropClaim, openClaim } from "@/lib/server/espn/loginClaims";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { connectSeason } from "@/lib/server/espn/seasonConnect";
import { error, json, readJson } from "@/lib/server/http";

/**
 * POST /api/espn/season/claim { claim } → { leagueId, created }
 *
 * The season page (src/app/espn/season/page.tsx) claiming the ESPN login the bridge handed off
 * (APE-297) for the signed-in user, then connecting the season with it (connectSeason()). One tap
 * on the page, not on load, so a link can't connect someone else's ESPN login to a user's account
 * behind their back. The claim is used up unless ESPN couldn't be reached, so the user
 * can retry that; 410 when it's unknown or expired, so the page can send them back to the bookmark.
 */
export const POST = withUser<unknown>(async (request, _ctx, { db, userId, email }) => {
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const code = (read.body as { claim?: unknown } | null)?.claim;
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(code)) return error(400, "Invalid claim");
  const claim = await openClaim(db, config.espnCodeKey, code);
  if (!claim) return error(410, "That link has expired. Tap the War Room bookmark on your ESPN league page again.");
  const result = await connectSeason(db, config.espnCodeKey, userId, {
    espnLeagueId: claim.espnLeagueId,
    season: claim.season,
    consentVersion: claim.consentVersion,
    ...claim.login,
  });
  if (result.ok || result.status !== 503) await dropClaim(db, code);
  if (!result.ok) return json(result.status, { error: result.error, ...(result.seasonVersion ? { seasonVersion: result.seasonVersion } : {}) });
  return json(200, { leagueId: result.leagueId, created: result.created });
});
