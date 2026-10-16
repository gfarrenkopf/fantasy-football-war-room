import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { mayUseSeason } from "@/lib/server/espn/access";
import { loadFills } from "@/lib/server/espn/waivers";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/season/fills">;

const ROUTE = "/api/leagues/[id]/season/fills";

/**
 * GET /api/leagues/:id/season/fills[?refresh=1] → { holes, fills }: the holes in this week's lineup
 * (APE-349), and for each hard one the free agents who could fill it now and the claims that clear
 * in time, each with how to make room. Free, like the lineup. 409 `{ problem }` when ESPN can't be read.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!(await mayUseSeason(db, userId, email))) return error(403, "In-season help isn't available on this account yet");
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const load = await loadFills(db, config.espnCodeKey, userId, id, { refresh });
    if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.problem });
    return json(200, { holes: load.holes, fills: load.fills });
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "The waiver wire couldn't be read just now");
  }
});
