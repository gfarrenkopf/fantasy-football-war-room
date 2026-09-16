import { and, count, eq, gt, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { generateAiPlan } from "@/lib/ai/generatePlan";
import { planInputHash, planSeed } from "@/lib/ai/planHash";
import { buildPlanInput } from "@/lib/ai/planInput";
import { FREE_REGENERATIONS, NO_PLAN, type PlanView } from "@/lib/ai/planView";
import { PLAN_PROMPT_VERSION } from "@/lib/ai/prompt";
import { costUsd } from "@/lib/ai/pricing";
import { PlanModelError, type ModelUsage, type PlanModel } from "@/lib/ai/provider";
import { DATASET_ID, dataset } from "@/lib/data";
import { aiGenerations, aiPlans, leagues, type AiPlanStatus, type GenerationOutcome } from "@/lib/db/schema";

export type { PlanView } from "@/lib/ai/planView";
import type { Db } from "@/lib/db/types";
import { validateLeague } from "@/lib/draft/league";
import { mulberry32 } from "@/lib/draft/sim";
import { formatServerError } from "./errorLog";
import { findLeague } from "./leagues";

/**
 * AI plan jobs. A plan takes a minute or more to write, so requesting one queues a job in
 * `ai_plans` and the route runs it after responding (Next's after()); the client polls for the
 * result. Everything that matters lives in the row, so a job survives reloads, and one killed by a
 * restart or deploy is picked up again:
 *
 * - Claiming is a single conditional UPDATE, so two requests or polls never start the same job twice.
 * - A claim holds a lease. A generating job past its lease is presumed dead and the next poll
 *   claims it again.
 * - Every claim sets a new `job_id`, and a job only saves its result while its id is current, so a
 *   superseded job (settings changed mid-run, or a reclaimed lease) can't overwrite a newer one.
 * - At most MAX_CONCURRENT_GENERATIONS run at once. The rest wait as `queued` and are claimed by
 *   their next poll once there's room.
 * - The last good plan is kept while a new job runs or fails.
 *
 * User-scoped like leagues.ts: a league the user doesn't own reads as not found.
 */

/** Longer than a slow generation (the model call itself is cut off at JOB_TIMEOUT_MS). */
export const PLAN_LEASE_MS = 4 * 60_000;
export const JOB_TIMEOUT_MS = 3 * 60_000;
/**
 * Plans a league may have written: its first plan plus FREE_REGENERATIONS rewrites, whether asked for
 * with Regenerate or after its settings changed. Only saved plans count, so retrying a failure is free.
 * The route gets the league's allowance from planAccess() (src/lib/server/ai).
 */
export { FREE_REGENERATIONS };
export const DEFAULT_PLAN_ALLOWANCE = 1 + FREE_REGENERATIONS;
/** Plans written at once, across all users. A soft cap: two simultaneous claims can pass it by one. */
export const MAX_CONCURRENT_GENERATIONS = 4;

export interface PlanResult {
  view: PlanView;
  /** A job this call claimed: the caller must run it (runPlanJob), after responding. */
  claimedJobId: string | null;
}

type PlanRow = typeof aiPlans.$inferSelect;

const iso = (date: Date | null) => date?.toISOString() ?? null;
const leaseLive = (row: PlanRow, now: Date) => row.leaseExpiresAt !== null && row.leaseExpiresAt > now;

async function readRow(db: Db, leagueId: string): Promise<PlanRow | null> {
  const [row] = await db.select().from(aiPlans).where(eq(aiPlans.leagueId, leagueId));
  return row ?? null;
}

/** Claims a waiting or abandoned job if there's room. Returns the new job id, or null. */
async function tryClaim(db: Db, leagueId: string, now: Date): Promise<string | null> {
  const [{ running }] = await db
    .select({ running: count() })
    .from(aiPlans)
    .where(and(eq(aiPlans.status, "generating"), gt(aiPlans.leaseExpiresAt, now)));
  if (running >= MAX_CONCURRENT_GENERATIONS) return null;

  const jobId = crypto.randomUUID();
  const [claimed] = await db
    .update(aiPlans)
    .set({
      status: "generating",
      jobId,
      leaseExpiresAt: new Date(now.getTime() + PLAN_LEASE_MS),
      startedAt: now,
      errorKind: null,
      attempts: sql`${aiPlans.attempts} + 1`,
    })
    .where(and(eq(aiPlans.leagueId, leagueId), or(eq(aiPlans.status, "queued"), and(eq(aiPlans.status, "generating"), lt(aiPlans.leaseExpiresAt, now)))))
    .returning({ jobId: aiPlans.jobId });
  return claimed ? jobId : null;
}

/** Plans saved for the league so far: the generation log's successful calls (APE-103). */
async function plansWritten(db: Db, leagueId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(aiGenerations)
    .where(and(eq(aiGenerations.leagueId, leagueId), eq(aiGenerations.outcome, "ready")));
  return n;
}

async function toView(db: Db, row: PlanRow | null, currentHash: string, now: Date, allowance: number): Promise<PlanView> {
  if (!row) return NO_PLAN;
  const written = await plansWritten(db, row.leagueId);

  // A generating job past its lease is dead; until something claims it again, it's waiting in line.
  const status: AiPlanStatus = row.status === "generating" && !leaseLive(row, now) ? "queued" : row.status;
  let queuePosition: number | null = null;
  if (status === "queued") {
    const [{ ahead }] = await db
      .select({ ahead: count() })
      .from(aiPlans)
      .where(and(eq(aiPlans.status, "queued"), lt(aiPlans.requestedAt, row.requestedAt)));
    queuePosition = ahead + 1;
  }
  return {
    status,
    plan: row.plan,
    stale: row.plan !== null && row.planInputHash !== currentHash,
    generatedAt: row.plan ? iso(row.completedAt) : null,
    requestedAt: iso(row.requestedAt),
    startedAt: status === "generating" ? iso(row.startedAt) : null,
    queuePosition,
    error: status === "failed" && row.errorKind ? { kind: row.errorKind, retryable: row.errorKind !== "invalid_league" } : null,
    regenerationsLeft: written > 0 ? Math.max(0, allowance - written) : null,
    limitReached: false,
    needsPurchase: false,
  };
}

/**
 * The league's plan and job status, or null if the user has no such league. Also the self-healing
 * path: a queued job with room to run, or a generating one whose lease expired, is claimed here.
 */
export async function getPlanStatus(
  db: Db,
  userId: string,
  leagueId: string,
  now = new Date(),
  allowance = DEFAULT_PLAN_ALLOWANCE,
): Promise<PlanResult | null> {
  const league = await findLeague(db, userId, leagueId);
  if (!league) return null;
  let row = await readRow(db, leagueId);

  let claimedJobId: string | null = null;
  if (row && (row.status === "queued" || (row.status === "generating" && !leaseLive(row, now)))) {
    claimedJobId = await tryClaim(db, leagueId, now);
    if (claimedJobId) row = await readRow(db, leagueId);
  }
  return {
    view: await toView(db, row, planInputHash(league.settings, DATASET_ID), now, allowance),
    claimedJobId,
  };
}

export type RequestPlanResult = PlanResult | { invalidLeague: string[] };

/**
 * Asks for a plan for the league's current settings. Idempotent: a job already queued or running
 * for these settings is returned as is, and a finished plan for them is returned without a new job
 * unless `regenerate` asks for a new version. Otherwise (never written, settings changed, the last
 * attempt failed, or regenerating) queues a job and tries to claim it, provided the league hasn't
 * used up its `allowance` of written plans. Past it, nothing is queued and the stored plan is
 * returned with `limitReached`: the limit holds however the request is made. Returns null if the
 * user has no such league.
 */
export async function requestPlan(
  db: Db,
  userId: string,
  leagueId: string,
  now = new Date(),
  { regenerate = false, allowance = DEFAULT_PLAN_ALLOWANCE }: { regenerate?: boolean; allowance?: number } = {},
): Promise<RequestPlanResult | null> {
  const league = await findLeague(db, userId, leagueId);
  if (!league) return null;
  const problems = validateLeague(league.settings, dataset);
  if (problems.length) return { invalidLeague: problems };

  const hash = planInputHash(league.settings, DATASET_ID);
  const row = await readRow(db, leagueId);
  const inFlight = row && (row.status === "queued" || row.status === "generating") && row.inputHash === hash;
  const upToDate = row && row.status === "ready" && row.planInputHash === hash;
  if (inFlight || (upToDate && !regenerate)) return getPlanStatus(db, userId, leagueId, now, allowance);

  if ((await plansWritten(db, leagueId)) >= allowance) {
    const status = await getPlanStatus(db, userId, leagueId, now, allowance);
    return status && { ...status, view: { ...status.view, limitReached: true } };
  }

  // A job running for older settings keeps going, but clearing job_id means its result is discarded.
  const queued = {
    status: "queued" as const,
    inputHash: hash,
    requestedAt: now,
    jobId: null,
    leaseExpiresAt: null,
    errorKind: null,
  };
  // Conditional, so two simultaneous requests can't both replace the row: the second finds the job
  // the first queued for the same settings and leaves it be, instead of superseding a paid call.
  await db
    .insert(aiPlans)
    .values({ leagueId, ...queued })
    .onConflictDoUpdate({
      target: aiPlans.leagueId,
      set: queued,
      setWhere: or(notInArray(aiPlans.status, ["queued", "generating"]), ne(aiPlans.inputHash, hash)),
    });
  return getPlanStatus(db, userId, leagueId, now, allowance);
}

/**
 * Writes the plan for a claimed job. Builds the input from the league's stored settings and the
 * bundled player data, calls the model, and saves the result, but only while `jobId` is still the
 * row's current job. Every model call is logged to `ai_generations` with its usage and cost, including
 * failed and superseded ones, since those are paid for too. Never throws: failures are recorded on
 * the row, and unexpected ones are also logged as [server-error] lines (errors inside after() never
 * reach onRequestError).
 */
export async function runPlanJob(
  db: Db,
  leagueId: string,
  jobId: string,
  { model, timeoutMs = JOB_TIMEOUT_MS }: { model: PlanModel; timeoutMs?: number },
): Promise<void> {
  const current = and(eq(aiPlans.leagueId, leagueId), eq(aiPlans.jobId, jobId));
  /** Set once the model is called, so the call gets logged however the job ends. */
  let call: { userId: string; startedAt: number; usage?: ModelUsage } | null = null;
  try {
    const [job] = await db.select({ userId: leagues.userId }).from(aiPlans).innerJoin(leagues, eq(leagues.id, aiPlans.leagueId)).where(current);
    const league = job && (await findLeague(db, job.userId, leagueId));
    if (!league) return; // superseded, or the league was deleted

    if (validateLeague(league.settings, dataset).length) {
      await db
        .update(aiPlans)
        .set({
          status: "failed",
          errorKind: "invalid_league",
          leaseExpiresAt: null,
          completedAt: new Date(),
        })
        .where(current);
      return;
    }
    const hash = planInputHash(league.settings, DATASET_ID);
    const input = buildPlanInput(league.settings, dataset, {
      rng: mulberry32(planSeed(hash)),
    });
    call = { userId: job.userId, startedAt: performance.now() };
    const generated = await generateAiPlan(model, input, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    call.usage = generated.usage;
    const saved = await db
      .update(aiPlans)
      .set({
        status: "ready",
        plan: generated.plan,
        planInputHash: hash,
        issues: generated.issues,
        provider: generated.provider,
        model: generated.model,
        promptVersion: PLAN_PROMPT_VERSION,
        errorKind: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      })
      .where(current)
      .returning({ leagueId: aiPlans.leagueId });
    await logGeneration(db, model, { leagueId, jobId, ...call, outcome: saved.length ? "ready" : "superseded" });
  } catch (error) {
    const kind = error instanceof PlanModelError ? error.kind : "internal";
    if (kind === "internal") {
      console.error(
        formatServerError(error, { method: "JOB", path: `/api/leagues/${leagueId}/plan` }, { routePath: "/api/leagues/[id]/plan", routeType: "after" }),
      );
    }
    if (call) {
      const usage = error instanceof PlanModelError ? (error.usage ?? call.usage) : call.usage;
      await logGeneration(db, model, { leagueId, jobId, ...call, usage, outcome: kind });
    }
    await db
      .update(aiPlans)
      .set({
        status: "failed",
        errorKind: kind,
        leaseExpiresAt: null,
        completedAt: new Date(),
      })
      .where(current)
      .catch(() => {}); // the database itself is failing; the lease will expire and a poll retries
  }
}

/** Records one model call in `ai_generations`. Never throws: losing a log line mustn't fail the job. */
async function logGeneration(
  db: Db,
  model: PlanModel,
  entry: { leagueId: string; jobId: string; userId: string; startedAt: number; usage?: ModelUsage; outcome: GenerationOutcome },
): Promise<void> {
  const { usage } = entry;
  try {
    await db.insert(aiGenerations).values({
      leagueId: entry.leagueId,
      userId: entry.userId,
      jobId: entry.jobId,
      provider: model.provider,
      model: model.model,
      promptVersion: PLAN_PROMPT_VERSION,
      outcome: entry.outcome,
      inputTokens: usage?.inputTokens ?? null,
      cachedInputTokens: usage ? (usage.cachedInputTokens ?? 0) : null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd: usage ? costUsd(model.provider, model.model, usage) : null,
      durationMs: Math.round(performance.now() - entry.startedAt),
    });
  } catch (error) {
    console.error(
      formatServerError(error, { method: "JOB", path: `/api/leagues/${entry.leagueId}/plan` }, { routePath: "/api/leagues/[id]/plan", routeType: "after" }),
    );
  }
}
