import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { loadSeason } from "@/lib/server/espn/seasonData";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/season/draft-teams">;

const ROUTE = "/api/leagues/[id]/season/draft-teams";

/**
 * GET /api/leagues/:id/season/draft-teams → { names }: the ESPN team name at each draft slot, slot 1
 * first (APE-225), so the post-draft room can say who made each pick. A slot ESPN doesn't name is
 * null. Read through the season cache, so a warm cache makes no ESPN call. 409 when ESPN can't be read.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  try {
    const load = await loadSeason(db, config.espnCodeKey, userId, id);
    if (load.kind === "not-linked") return error(404, "This league doesn't follow ESPN");
    if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.kind });
    const { teams, draftOrder } = load.league;
    return json(200, { names: draftOrder.map((teamId) => teams.find((t) => t.id === teamId)?.name ?? null) });
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "ESPN couldn't be read just now");
  }
});
