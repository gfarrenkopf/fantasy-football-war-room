import type { ModelUsage } from "./provider";

/**
 * What each plan model costs, for the generation log (APE-103). USD per million tokens, from the
 * providers' published first-party rates (checked 2026-09-16). A cost is priced when the generation
 * is logged, so updating a price here never rewrites history. A model missing here is logged unpriced.
 */
export interface TokenPrices {
  input: number;
  /** Input tokens read from the provider's prompt cache. */
  cachedInput: number;
  output: number;
}

/** Matched by model id prefix, most specific first. */
const PRICES: Record<string, [prefix: string, prices: TokenPrices][]> = {
  anthropic: [
    ["claude-fable-5", { input: 10, cachedInput: 1, output: 50 }],
    ["claude-opus-5", { input: 5, cachedInput: 0.5, output: 25 }],
    ["claude-opus-4-8", { input: 5, cachedInput: 0.5, output: 25 }],
    ["claude-opus-4-7", { input: 5, cachedInput: 0.5, output: 25 }],
    ["claude-opus-4-6", { input: 5, cachedInput: 0.5, output: 25 }],
    ["claude-sonnet-5", { input: 2, cachedInput: 0.2, output: 10 }],
    ["claude-sonnet-4-6", { input: 3, cachedInput: 0.3, output: 15 }],
    ["claude-sonnet-4-5", { input: 3, cachedInput: 0.3, output: 15 }],
    ["claude-haiku-4-5", { input: 1, cachedInput: 0.1, output: 5 }],
  ],
};

export function pricesFor(provider: string, model: string): TokenPrices | null {
  return PRICES[provider]?.find(([prefix]) => model.startsWith(prefix))?.[1] ?? null;
}

/** The cost of one call in USD, or null when the model's price isn't known. */
export function costUsd(provider: string, model: string, usage: ModelUsage): number | null {
  const prices = pricesFor(provider, model);
  if (!prices) return null;
  const dollars = usage.inputTokens * prices.input + (usage.cachedInputTokens ?? 0) * prices.cachedInput + usage.outputTokens * prices.output;
  return dollars / 1_000_000;
}
