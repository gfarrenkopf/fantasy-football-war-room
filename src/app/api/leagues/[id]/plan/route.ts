import { after } from "next/server";
import { runPlanJob, getPlanStatus, requestPlan } from "@/lib/server/aiPlans";
import { canUseAiPlan, getPlanModel } from "@/lib/server/ai";
import type { Db } from "@/lib/db";
import { withUser } from "@/lib/server/api";
import { error, json } from "@/lib/server/http";

type Ctx = RouteContext<"/api/leagues/[id]/plan">;

/** 404 when AI plans are off, 403 for accounts not allowed to use them yet. */
function unavailable(email: string | null): Response | null {
  if (!getPlanModel()) return error(404, "Not found");
  if (!canUseAiPlan(email)) return error(403, "AI game plans aren't available on this account yet");
  return null;
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
export const GET = withUser<Ctx>(async (_request, ctx, { db, userId, email }) => {
  const blocked = unavailable(email);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const result = await getPlanStatus(db, userId, id);
  if (!result) return error(404, "League not found");
  runAfterResponse(db, id, result.claimedJobId);
  return json(200, result.view);
});

/**
 * POST /api/leagues/:id/plan → 202 PlanView while the plan is written in the background, or 200 when
 * an up-to-date plan already exists. Built from the league as stored on the server.
 */
export const POST = withUser<Ctx>(async (_request, ctx, { db, userId, email }) => {
  const blocked = unavailable(email);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const result = await requestPlan(db, userId, id);
  if (!result) return error(404, "League not found");
  if ("invalidLeague" in result) return error(422, result.invalidLeague[0]);
  runAfterResponse(db, id, result.claimedJobId);
  return json(result.view.status === "ready" ? 200 : 202, result.view);
});
