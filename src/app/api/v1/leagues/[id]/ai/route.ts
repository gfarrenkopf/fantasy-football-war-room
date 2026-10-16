import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { getPlanModel } from "@/lib/server/ai";
import { seasonAiState } from "@/lib/server/ai/season";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { aiResponse, type AiResponse } from "@/lib/server/v1/ai";

type Ctx = RouteContext<"/api/v1/leagues/[id]/ai">;

const ROUTE = "/api/v1/leagues/[id]/ai";

/**
 * GET /api/v1/leagues/:id/ai → AiResponse (src/lib/server/v1/ai.ts)
 *
 * In-season AI for the app's Lineup and Trades tabs (APE-390): this week's AI lineup and trade
 * ideas, what the user may do next, and the account's access, from what the web's season page
 * loads (seasonAiState()). 404 when in-season AI is off, 403 when this account isn't allowed it
 * (the app shows no AI then, as the web shows none), 409 `{ problem }` when ESPN can't be read.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  if (!getPlanModel()) return error(404, "Not found");
  const { id } = await ctx.params;
  const league = await findLeague(db, userId, id);
  if (!league) return error(404, "League not found");
  try {
    const load = await loadSeasonView(db, config.espnCodeKey!, userId, id);
    if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.kind });
    const ai = await seasonAiState(db, { userId, email }, { id, season: league.season }, load.view);
    if (!ai) return error(403, "In-season AI isn't available on this account yet");
    return json(200, aiResponse(load.view, ai) satisfies AiResponse);
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "In-season AI is temporarily unavailable");
  }
});
