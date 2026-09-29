import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { loadWaivers } from "@/lib/server/espn/waivers";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/season/waivers">;

const ROUTE = "/api/leagues/[id]/season/waivers";

/**
 * GET /api/leagues/:id/season/waivers[?refresh=1] → { pickups, considered, fetchedAt }: the waiver-wire
 * players who'd most improve the user's best lineup for the rest of the season (APE-212), each with
 * who to drop. Free, like the lineup and trade verdict. 409 `{ problem }` when ESPN can't be read.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const load = await loadWaivers(db, config.espnCodeKey, userId, id, { refresh });
    if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.problem });
    return json(200, { pickups: load.pickups, considered: load.considered, fetchedAt: load.fetchedAt.toISOString() });
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "The waiver wire couldn't be read just now");
  }
});
