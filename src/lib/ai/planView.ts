import type { AiPlan } from "./planSchema";

/**
 * The AI plan as the client sees it: the stored plan plus where its background job stands.
 * Built by src/lib/server/aiPlans.ts, read by the plan store and UI.
 */

export type PlanJobStatus = "queued" | "generating" | "ready" | "failed";

export interface PlanError {
  /** A PlanModelError kind, "internal" for anything unexpected, or "invalid_league". */
  kind: string;
  /** Whether trying again can help. */
  retryable: boolean;
}

export interface PlanView {
  /** "none": no plan was ever requested for the league. */
  status: "none" | PlanJobStatus;
  /** The latest good plan, kept while a new one is written or when writing it failed. */
  plan: AiPlan | null;
  /** The plan was written for different league settings or player data than the league has now. */
  stale: boolean;
  generatedAt: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  /** 1-based place in line while queued. */
  queuePosition: number | null;
  error: PlanError | null;
}

export const NO_PLAN: PlanView = {
  status: "none",
  plan: null,
  stale: false,
  generatedAt: null,
  requestedAt: null,
  startedAt: null,
  queuePosition: null,
  error: null,
};

/** A job is waiting or running: keep polling. */
export const isWorking = (view: PlanView) => view.status === "queued" || view.status === "generating";

/** Poll quickly for the first minute, when a plan is most often about to land, then ease off. */
const FAST_POLL_MS = 3_000;
const SLOW_POLL_MS = 10_000;
const FAST_FOR_MS = 60_000;

/** Milliseconds until the next status poll, or null when there's nothing to wait for. */
export function nextPollDelay(view: PlanView, waitingMs: number): number | null {
  if (!isWorking(view)) return null;
  return waitingMs < FAST_FOR_MS ? FAST_POLL_MS : SLOW_POLL_MS;
}

/** Past the job's lease plus a margin: by now a healthy job has finished or been reclaimed. */
export const PLAN_OVERDUE_MS = 5 * 60_000;

/**
 * Why the AI tab should also show the live, algorithmic turn plan, or null when it needn't:
 * - failed: the last job failed (provider down, timed out, unusable output);
 * - unreachable: the last status read or request didn't get an answer from the server;
 * - slow: a job has been waiting or running for longer than a healthy one takes;
 * - writing: a job is waiting or running.
 * The AI plan never blocks the user: whenever it isn't there, the live plan is.
 */
export type FallbackReason = "failed" | "unreachable" | "slow" | "writing";

export function planFallback(view: PlanView | null, unreachable: boolean, waitingMs: number): FallbackReason | null {
  if (unreachable) return "unreachable";
  if (!view) return null;
  if (view.status === "failed") return "failed";
  if (isWorking(view)) return waitingMs > PLAN_OVERDUE_MS ? "slow" : "writing";
  return null;
}

const STATUSES = new Set(["none", "queued", "generating", "ready", "failed"]);
const str = (x: unknown) => (typeof x === "string" ? x : null);

/**
 * Checks a PlanView from the API. The server built it, so this guards against a truncated or
 * foreign response rather than re-validating the plan itself. Returns null when it isn't one.
 */
export function parsePlanView(raw: unknown): PlanView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.status !== "string" || !STATUSES.has(v.status)) return null;
  const plan = v.plan as AiPlan | null;
  if (plan !== null && (typeof plan !== "object" || typeof plan.intro !== "string" || !Array.isArray(plan.turns))) return null;
  const error = v.error as PlanError | null;
  return {
    status: v.status as PlanView["status"],
    plan: plan ?? null,
    stale: v.stale === true,
    generatedAt: str(v.generatedAt),
    requestedAt: str(v.requestedAt),
    startedAt: str(v.startedAt),
    queuePosition: typeof v.queuePosition === "number" ? v.queuePosition : null,
    error: error && typeof error.kind === "string" ? { kind: error.kind, retryable: error.retryable === true } : null,
  };
}
