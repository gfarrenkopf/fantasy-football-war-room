import { withUser } from "@/lib/server/api";
import { readLoginBody, seasonGate } from "@/lib/server/espn/appEspn";
import { listFanLeagues } from "@/lib/server/espn/fanLeagues";
import { error, json } from "@/lib/server/http";

/**
 * POST /api/v1/espn/leagues { espnS2, swid } → { leagues: [{ espnLeagueId, name, season, espnTeamId, teamName }] }
 *
 * The ESPN fantasy football leagues the login the app just captured can see, so the user picks one
 * instead of typing an id. Nothing is stored: connecting is POST /api/v1/espn/connect.
 */
export const POST = withUser<unknown>(async (request, _ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const read = await readLoginBody(request);
  if (!read.ok) return read.response;
  const result = await listFanLeagues(read.login);
  if (!result.ok) {
    return result.reason === "auth"
      ? error(400, "ESPN didn't accept that sign-in. Sign in to ESPN again.")
      : error(503, "Couldn't reach ESPN. Try again in a minute.");
  }
  return json(200, { leagues: result.leagues });
});
