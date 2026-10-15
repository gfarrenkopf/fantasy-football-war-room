import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { writeTradeIdeas } from "@/lib/server/seasonAiOutputs";
import { appAiRequest, appAiResponse } from "@/lib/server/v1/aiRoute";

type Ctx = RouteContext<"/api/v1/leagues/[id]/ai/trade-ideas">;

const ROUTE = "/api/v1/leagues/[id]/ai/trade-ideas";

/**
 * POST /api/v1/leagues/:id/ai/trade-ideas → AiResponse: finds and writes this week's trade ideas
 * (APE-390), as the web's season/trade-ideas route does, or serves the set already stored. When no
 * trade clears the bar, `none: true` rides along and nothing is used. 409 `{ deadline: true }` after
 * the trade deadline, 409 `{ used: true }`, 402 `{ locked: true }` past the trial, 503 when the model fails.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  try {
    const req = await appAiRequest(db, { userId, email }, id);
    if (req instanceof Response) return req;
    const result = await writeTradeIdeas(db, req.model, { userId, leagueId: id, view: req.view });
    switch (result.status) {
      case "ok":
        if (!result.cached) await req.began();
        return json(200, await appAiResponse(db, { userId, email }, req));
      case "none":
        return json(200, { ...(await appAiResponse(db, { userId, email }, req)), none: true });
      case "deadline":
        return json(409, { error: "The trade deadline has passed", deadline: true });
      case "used":
        return json(409, { error: "This week's trade ideas are already found. Pull to refresh to see them.", used: true });
      default:
        return error(503, "The trade ideas couldn't be written just now. Nothing was used; try again.");
    }
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "In-season AI is temporarily unavailable");
  }
});
