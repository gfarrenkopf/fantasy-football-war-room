import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { loadFills } from "@/lib/server/espn/waivers";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import type { FillsResponse } from "@/lib/server/v1/team";

type Ctx = RouteContext<"/api/v1/leagues/[id]/team/fills">;

const ROUTE = "/api/v1/leagues/[id]/team/fills";

/**
 * GET /api/v1/leagues/:id/team/fills[?refresh=1] → FillsResponse (src/lib/server/v1/team.ts)
 *
 * The holes in this week's lineup and the ranked ways to fill the hard ones (APE-349), as the web's
 * season/fills route reads them (loadFills()), for the app's "Fill it" (19.5). 409 `{ problem }`
 * when ESPN can't be read.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const load = await loadFills(db, config.espnCodeKey!, userId, id, { refresh });
    if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.problem });
    return json(200, { holes: load.holes, fills: load.fills } satisfies FillsResponse);
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "The waiver wire couldn't be read just now");
  }
});
