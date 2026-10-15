import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { writeAiLineup } from "@/lib/server/seasonAiOutputs";
import { appAiRequest, appAiResponse } from "@/lib/server/v1/aiRoute";

type Ctx = RouteContext<"/api/v1/leagues/[id]/ai/lineup">;

const ROUTE = "/api/v1/leagues/[id]/ai/lineup";

/**
 * POST /api/v1/leagues/:id/ai/lineup → AiResponse: writes this week's mid-week AI lineup (APE-390),
 * as the web's season/lineup route does, or serves the one already stored, then answers with GET ai's
 * body. Writing can take up to 90 seconds. 409 `{ used: true }` when the week's allowance went
 * without a stored lineup, 402 `{ locked: true }` past the trial, 503 when the model fails.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  try {
    const req = await appAiRequest(db, { userId, email }, id);
    if (req instanceof Response) return req;
    const result = await writeAiLineup(db, req.model, { userId, leagueId: id, view: req.view, kind: "lineup-midweek" });
    if (result.status === "used") return json(409, { error: "This week's AI lineup is already used", used: true });
    if (result.status !== "ok") return error(503, "The AI lineup couldn't be written just now. The recommended lineup still stands.");
    if (!result.cached) await req.began();
    return json(200, await appAiResponse(db, { userId, email }, req));
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "In-season AI is temporarily unavailable");
  }
});
