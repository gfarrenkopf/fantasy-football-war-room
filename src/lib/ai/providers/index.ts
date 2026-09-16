import type { PlanModel } from "../provider";
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicPlanModel } from "./anthropic";

/**
 * Every model provider the AI plan can use. To add one: write an adapter that implements
 * PlanModel, register it here, and add its API key to src/lib/config.ts and .env.example.
 */
export const PLAN_PROVIDERS = {
  anthropic: { defaultModel: ANTHROPIC_DEFAULT_MODEL, create: createAnthropicPlanModel },
} satisfies Record<string, { defaultModel: string; create(options: { apiKey: string; model?: string }): PlanModel }>;

export type PlanProviderName = keyof typeof PLAN_PROVIDERS;

export const isPlanProvider = (name: string): name is PlanProviderName => Object.hasOwn(PLAN_PROVIDERS, name);

/** Builds the configured provider's model, using its default model id when none is given. */
export function createPlanModel(provider: PlanProviderName, { apiKey, model }: { apiKey: string; model?: string }): PlanModel {
  const def = PLAN_PROVIDERS[provider];
  return def.create({ apiKey, model: model ?? def.defaultModel });
}
