import { withUser } from "@/lib/server/api";
import { seasonAiRequest } from "@/lib/server/ai/season";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { writeAiLineup } from "@/lib/server/seasonAiOutputs";

type Ctx = RouteContext<"/api/leagues/[id]/season/lineup">;

const ROUTE = "/api/leagues/[id]/season/lineup";

/**
 * POST /api/leagues/:id/season/lineup → { lineup, createdAt }: this week's mid-week AI lineup (11.2),
 * written now or the one already stored. 409 `{ used: true }` when the week's allowance went without
 * a stored lineup, 503 when the model fails (the free optimal lineup still stands). See
 * seasonAiRequest() for the checks before that, including 402 past the trial.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  try {
    const req = await seasonAiRequest(db, { userId, email }, id);
    if (req instanceof Response) return req;
    const result = await writeAiLineup(db, req.model, { userId, leagueId: id, view: req.view, kind: "lineup-midweek" });
    if (result.status === "used") return json(409, { error: "This week's AI lineup is already used", used: true });
    if (result.status !== "ok") return error(503, "The AI lineup couldn't be written just now. The recommended lineup above still stands.");
    if (!result.cached) await req.began();
    return json(200, { lineup: result.output, createdAt: result.createdAt });
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "In-season AI is temporarily unavailable");
  }
});
