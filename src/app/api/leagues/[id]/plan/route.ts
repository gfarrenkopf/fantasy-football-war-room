import { after } from "next/server";
import { runPlanJob, getPlanStatus, requestPlan } from "@/lib/server/aiPlans";
import { canUseAiPlan, getPlanModel } from "@/lib/server/ai";
import type { Db } from "@/lib/db";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";

type Ctx = RouteContext<"/api/leagues/[id]/plan">;

const ROUTE = "/api/leagues/[id]/plan";

/** 404 when AI plans are off, 403 for accounts not allowed to use them yet. */
function unavailable(email: string | null): Response | null {
  if (!getPlanModel()) return error(404, "Not found");
  if (!canUseAiPlan(email)) return error(403, "AI game plans aren't available on this account yet");
  return null;
}

/**
 * Runs a plan read or request, answering 503 if it throws (e.g. the database is down) so the client
 * shows the live turn plan instead. Still logged as a [server-error] line for the alert emails.
 */
async function guarded(request: Request, route: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: route, routeType: "route" }));
    return error(503, "AI game plans are temporarily unavailable");
  }
}

/** Runs a claimed job after the response is sent. The job records its own outcome and never throws. */
function runAfterResponse(db: Db, leagueId: string, jobId: string | null) {
  const model = getPlanModel();
  if (jobId && model) after(() => runPlanJob(db, leagueId, jobId, { model }));
}

/**
 * GET /api/leagues/:id/plan → PlanView (see src/lib/server/aiPlans.ts).
 * Polled while a plan is being written. Also resumes a job a restart interrupted.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const blocked = unavailable(email);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  return guarded(request, ROUTE, async () => {
    const result = await getPlanStatus(db, userId, id);
    if (!result) return error(404, "League not found");
    runAfterResponse(db, id, result.claimedJobId);
    return json(200, result.view);
  });
});

/**
 * POST /api/leagues/:id/plan → 202 PlanView while the plan is written in the background, or 200 when
 * an up-to-date plan already exists. Built from the league as stored on the server.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const blocked = unavailable(email);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  return guarded(request, ROUTE, async () => {
    const result = await requestPlan(db, userId, id);
    if (!result) return error(404, "League not found");
    if ("invalidLeague" in result) return error(422, result.invalidLeague[0]);
    runAfterResponse(db, id, result.claimedJobId);
    return json(result.view.status === "ready" ? 200 : 202, result.view);
  });
});
