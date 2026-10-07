import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { ESPN_SEASON_DISCLOSURE, ESPN_SEASON_VERSION } from "@/lib/espn/disclosure";
import { preflight, withCors } from "@/lib/server/espn/bridgeCors";
import { createClaim } from "@/lib/server/espn/loginClaims";
import { parseEspnLogin } from "@/lib/server/espn/logins";
import { error, json, readJson } from "@/lib/server/http";

const enabled = () => config.espnSeasonEnabled && !!config.espnCodeKey;

export function OPTIONS(request: Request) {
  return preflight(request, enabled());
}

/**
 * GET /api/espn/season/handoff → { version, lines }
 *
 * What the bridge overlay shows before "Connect my season": the season disclosure, served from
 * here so its wording lives only in src/lib/espn/disclosure.ts.
 */
export function GET(request: Request) {
  if (!enabled()) return withCors(error(404, "Not found"), request);
  return withCors(json(200, { version: ESPN_SEASON_VERSION, lines: ESPN_SEASON_DISCLOSURE }), request);
}

/**
 * POST /api/espn/season/handoff { espnLeagueId, season, consentVersion, espnS2, swid } → { claim }
 *
 * The bridge handing over the user's ESPN login once they've agreed in the overlay (APE-297). No
 * War Room session reaches ESPN's site, so this only parks the login under a one-time claim code
 * (src/lib/server/espn/loginClaims.ts); the bridge then opens /espn/season?claim=… in the same tab,
 * where the signed-in user claims it. The login is a credential: it's sealed before it's stored, and
 * no response or log line here includes it. 409 when the consent the user saw is out of date, 503
 * when too many claims are waiting.
 */
export async function POST(request: Request) {
  if (!enabled()) return withCors(error(404, "Not found"), request);
  const read = await readJson(request);
  if (!read.ok) return withCors(read.response, request);
  const b = (read.body ?? {}) as { espnLeagueId?: unknown; season?: unknown; consentVersion?: unknown };
  const login = parseEspnLogin(read.body);
  if (typeof b.espnLeagueId !== "string" || !/^\d{1,12}$/.test(b.espnLeagueId) || !Number.isInteger(b.season) || !login) {
    return withCors(error(400, "Invalid hand-off"), request);
  }
  const season = b.season as number;
  if (season < 2000 || season > 2100) return withCors(error(400, "Invalid hand-off"), request);
  if (b.consentVersion !== ESPN_SEASON_VERSION) return withCors(json(409, { seasonVersion: ESPN_SEASON_VERSION }), request);
  const claim = await createClaim(getDb(), config.espnCodeKey!, login, { espnLeagueId: b.espnLeagueId, season, consentVersion: ESPN_SEASON_VERSION });
  if (!claim) return withCors(error(503, "Draft Room is busy. Try again in a few minutes."), request);
  return withCors(json(200, { claim }), request);
}
