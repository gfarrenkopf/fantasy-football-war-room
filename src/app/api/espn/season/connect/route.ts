import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { connectSeason, type ConnectRequest } from "@/lib/server/espn/seasonConnect";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { error, json, readJson } from "@/lib/server/http";

function parse(body: unknown): ConnectRequest | null {
  const b = (body ?? {}) as Partial<ConnectRequest>;
  if (typeof b.espnLeagueId !== "string" || !/^\d{1,12}$/.test(b.espnLeagueId)) return null;
  if (!Number.isInteger(b.season) || b.season! < 2000 || b.season! > 2100) return null;
  if (!Number.isInteger(b.consentVersion)) return null;
  // espn_s2 is URL-encoded base64, a few hundred characters.
  if (typeof b.espnS2 !== "string" || !/^[A-Za-z0-9%+/=._-]{20,2000}$/.test(b.espnS2)) return null;
  if (typeof b.swid !== "string" || !/^\{[0-9A-Fa-f-]{36}\}$/.test(b.swid)) return null;
  return { espnLeagueId: b.espnLeagueId, season: b.season!, consentVersion: b.consentVersion!, espnS2: b.espnS2, swid: b.swid };
}

/**
 * POST /api/espn/season/connect { espnLeagueId, season, consentVersion, espnS2, swid } → { leagueId, created }
 *
 * The season popup (src/app/espn/season/page.tsx) connecting the user's ESPN league for the season
 * (10.3), with the login the bridge read in their ESPN tab. Same-origin and signed in, so no bridge
 * token is involved. The login is a credential: it's checked against ESPN, sealed before it's stored,
 * and no response or log line here includes it. 409 when the consent the user saw is out of date.
 */
export const POST = withUser<unknown>(async (request, _ctx, { db, userId, email }) => {
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parse(read.body);
  if (!body) return error(400, "Invalid connect request");
  const result = await connectSeason(db, config.espnCodeKey, userId, body);
  if (!result.ok) return json(result.status, { error: result.error, ...(result.seasonVersion ? { seasonVersion: result.seasonVersion } : {}) });
  return json(200, { leagueId: result.leagueId, created: result.created });
});
