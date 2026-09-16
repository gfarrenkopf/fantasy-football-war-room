import { after } from "next/server";
import { isWorking, NEEDS_PURCHASE } from "@/lib/ai/planView";
import { runPlanJob, getPlanStatus, requestPlan } from "@/lib/server/aiPlans";
import { getPlanModel, planAccess } from "@/lib/server/ai";
import type { Db } from "@/lib/db";
import { withUser } from "@/lib/server/api";
import { findLeague } from "@/lib/server/leagues";
import type { PlanAccess } from "@/lib/server/planAccess";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";

type Ctx = RouteContext<"/api/leagues/[id]/plan">;

const ROUTE = "/api/leagues/[id]/plan";

/**
 * The league's access to AI plans, or the response to send instead: 404 when AI plans are off or the
 * league isn't the user's, 403 for accounts not allowed to use them yet. A league that needs a season
 * pass is returned as such: reads show the paywall, requests are refused with 402.
 */
async function access(db: Db, userId: string, leagueId: string, email: string | null): Promise<Exclude<PlanAccess, { kind: "not-allowed" }> | Response> {
  if (!getPlanModel()) return error(404, "Not found");
  if (!(await findLeague(db, userId, leagueId))) return error(404, "League not found");
  const result = await planAccess(db, leagueId, email);
  if (result.kind === "not-allowed") return error(403, "AI game plans aren't available on this account yet");
  return result;
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
  const { id } = await ctx.params;
  return guarded(request, ROUTE, async () => {
    const allowed = await access(db, userId, id, email);
    if (allowed instanceof Response) return allowed;
    if (allowed.kind === "needs-purchase") return json(200, NEEDS_PURCHASE);
    const result = await getPlanStatus(db, userId, id, new Date(), allowed.allowance);
    if (!result) return error(404, "League not found");
    runAfterResponse(db, id, result.claimedJobId);
    return json(200, result.view);
  });
});

/**
 * POST /api/leagues/:id/plan → 202 PlanView while the plan is written in the background, 200 when
 * there's nothing to wait for, or 402 with a `needsPurchase` PlanView when the league has no season pass. Built from the league as stored on the server. An optional JSON
 * body `{ "regenerate": true }` asks for a new version of an up-to-date plan. Past the league's
 * allowance nothing is written: 200 with the stored plan and `limitReached: true`.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  return guarded(request, ROUTE, async () => {
    const allowed = await access(db, userId, id, email);
    if (allowed instanceof Response) return allowed;
    if (allowed.kind === "needs-purchase") return json(402, NEEDS_PURCHASE);
    const body: unknown = await request.json().catch(() => null);
    const regenerate = (body as { regenerate?: unknown } | null)?.regenerate === true;
    const result = await requestPlan(db, userId, id, new Date(), { regenerate, allowance: allowed.allowance });
    if (!result) return error(404, "League not found");
    if ("invalidLeague" in result) return error(422, result.invalidLeague[0]);
    runAfterResponse(db, id, result.claimedJobId);
    return json(isWorking(result.view) ? 202 : 200, result.view);
  });
});
