import { withUser } from "@/lib/server/api";
import { seasonAiRequest } from "@/lib/server/ai/season";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { writeTradeIdeas } from "@/lib/server/seasonAiOutputs";

type Ctx = RouteContext<"/api/leagues/[id]/season/trade-ideas">;

const ROUTE = "/api/leagues/[id]/season/trade-ideas";

/**
 * POST /api/leagues/:id/season/trade-ideas → { ideas, createdAt }: this week's trade ideas (APE-222),
 * found and written now or the set already stored. `{ ideas: null, none: true }` when no trade clears
 * the bar, which uses nothing. 409 `{ deadline: true }` after the trade deadline, 409 `{ used: true }`
 * when the week's allowance went without a stored set, 503 when the model fails. See
 * seasonAiRequest() for the checks before that, including 402 past the trial.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  try {
    const req = await seasonAiRequest(db, { userId, email }, id);
    if (req instanceof Response) return req;
    const result = await writeTradeIdeas(db, req.model, { userId, leagueId: id, view: req.view });
    switch (result.status) {
      case "ok":
        if (!result.cached) await req.began();
        return json(200, { ideas: result.output, createdAt: result.createdAt });
      case "none":
        return json(200, { ideas: null, none: true });
      case "deadline":
        return json(409, { error: "The trade deadline has passed", deadline: true });
      case "used":
        return json(409, { error: "This week's trade ideas are already found. Reload to see them.", used: true });
      default:
        return error(503, "The trade ideas couldn't be written just now. Nothing was used; try again.");
    }
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "In-season AI is temporarily unavailable");
  }
});
