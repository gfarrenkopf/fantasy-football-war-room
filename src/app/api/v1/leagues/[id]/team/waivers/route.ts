import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { loadWaivers } from "@/lib/server/espn/waivers";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { waiversResponse } from "@/lib/server/v1/team";

type Ctx = RouteContext<"/api/v1/leagues/[id]/team/waivers">;

const ROUTE = "/api/v1/leagues/[id]/team/waivers";

/**
 * GET /api/v1/leagues/:id/team/waivers[?refresh=1] → WaiversResponse (src/lib/server/v1/team.ts)
 *
 * The iPhone app's Waivers tab (APE-386): the web's waiver wire (loadWaivers(), as the web's
 * season/waivers route reads it), with the waiver note, whether Draft Room claims in this league, and
 * who the user could drop. 409 `{ problem }` when ESPN can't be read.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const load = await loadWaivers(db, config.espnCodeKey!, userId, id, { refresh });
    if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.problem });
    return json(200, waiversResponse(load.view, load));
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "The waiver wire couldn't be read just now");
  }
});
