import { config } from "@/lib/config";
import { ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { withUser } from "@/lib/server/api";
import { readLoginBody, seasonGate } from "@/lib/server/espn/appEspn";
import { acknowledgeDisclosure } from "@/lib/server/espn/disclosure";
import { connectSeason } from "@/lib/server/espn/seasonConnect";
import { error, json } from "@/lib/server/http";

/**
 * POST /api/v1/espn/connect { espnS2, swid, espnLeagueId, season, consentVersion } → { leagueId, created }
 *
 * The app's ESPN connect: the login it read from ESPN's sign-in page and the league the user picked,
 * through connectSeason(), like the web's claim route. The app shows the disclosure first, so a
 * current `consentVersion` records the user's agreement; an old one gets connectSeason()'s 409 with
 * the version to show instead. Errors are connectSeason()'s, written for the user.
 */
export const POST = withUser<unknown>(async (request, _ctx, { db, userId, email }) => {
  const gated = seasonGate(email);
  if (gated) return gated;
  const read = await readLoginBody(request);
  if (!read.ok) return read.response;
  const { espnLeagueId, season, consentVersion } = read.body;
  if (typeof espnLeagueId !== "string" || !/^\d{1,12}$/.test(espnLeagueId)) return error(400, "Pick an ESPN league");
  if (typeof season !== "number" || !Number.isInteger(season) || season < 2000 || season > 2100) return error(400, "Pick an ESPN league");
  if (typeof consentVersion !== "number") return error(400, "consentVersion is required");

  const result = await connectSeason(db, config.espnCodeKey!, userId, { ...read.login, espnLeagueId, season, consentVersion });
  if (!result.ok) return json(result.status, { error: result.error, ...(result.seasonVersion ? { seasonVersion: result.seasonVersion } : {}) });
  if (consentVersion === ESPN_DISCLOSURE_VERSION) await acknowledgeDisclosure(db, userId, ESPN_DISCLOSURE_VERSION);
  return json(200, { leagueId: result.leagueId, created: result.created });
});
