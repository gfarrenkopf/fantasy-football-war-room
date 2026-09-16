import "server-only";
import type { PlanModel } from "@/lib/ai/provider";
import { createPlanModel, isPlanProvider } from "@/lib/ai/providers";
import { config } from "@/lib/config";

/** The configured plan model, or null when AI plans are off. */
export function getPlanModel(): PlanModel | null {
  if (!config.aiEnabled || !config.aiApiKey || !isPlanProvider(config.aiProvider)) return null;
  return createPlanModel(config.aiProvider, {
    apiKey: config.aiApiKey,
    model: config.aiModel,
  });
}

/**
 * Whether this account may generate AI plans. Until payments exist (Epic 4.4 replaces this with an
 * entitlement check), AI_ALLOWLIST limits it to listed emails; an empty list allows everyone.
 */
export function canUseAiPlan(email: string | null): boolean {
  if (!config.aiAllowlist.length) return true;
  return email !== null && config.aiAllowlist.includes(email.toLowerCase());
}
