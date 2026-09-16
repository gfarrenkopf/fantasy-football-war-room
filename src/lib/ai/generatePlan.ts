import { buildPlanPrompt } from "./prompt";
import type { PlanInput } from "./planInput";
import { PLAN_OUTPUT_SCHEMA, validateAiPlan, type AiPlan } from "./planSchema";
import { PlanModelError, type ModelEffort, type ModelUsage, type PlanModel } from "./provider";

export interface GeneratedPlan {
  plan: AiPlan;
  /** What validation dropped or repaired. Empty for a clean response. */
  issues: string[];
  provider: string;
  model: string;
  usage: ModelUsage;
  durationMs: number;
}

/**
 * A plan is 1-3k tokens of JSON, but models that reason before answering spend output tokens on that
 * too: at its default (high) effort Sonnet 5 ran past 16k. Effort is the real control; this is headroom.
 */
const MAX_OUTPUT_TOKENS = 32_000;

/** Enough reasoning to keep the roster and the numbers straight, without minutes of it. */
export const DEFAULT_PLAN_EFFORT: ModelEffort = "medium";

/**
 * Asks `model` for a plan grounded in `input`, and validates it. Throws PlanModelError when the
 * provider fails or the response is unusable ("invalid_output"), so callers can fall back.
 */
export async function generateAiPlan(
  model: PlanModel,
  input: PlanInput,
  { signal, effort = DEFAULT_PLAN_EFFORT }: { signal?: AbortSignal; effort?: ModelEffort } = {},
): Promise<GeneratedPlan> {
  const start = performance.now();
  const { system, user } = buildPlanPrompt(input);
  const { json, usage } = await model.generate({ system, user, schema: PLAN_OUTPUT_SCHEMA, maxTokens: MAX_OUTPUT_TOKENS, effort, signal });

  const result = validateAiPlan(json, input);
  if (!result.ok) throw new PlanModelError("invalid_output", `Unusable plan: ${result.issues.join("; ")}`, usage);
  return { plan: result.plan, issues: result.issues, provider: model.provider, model: model.model, usage, durationMs: performance.now() - start };
}
