/**
 * The AI plan CLI's single env reader, the counterpart of scripts/ingest/env.mts: `src/lib/config.ts`
 * imports "server-only" and can't be loaded by a plain node script. Keep these names in step with it.
 */
import { isPlanProvider, PLAN_PROVIDERS, type PlanProviderName } from "@/lib/ai/providers";

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** API key env var per provider. */
const KEYS: Record<PlanProviderName, string> = { anthropic: "ANTHROPIC_API_KEY" };

export const env = Object.freeze({
  provider: read("AI_PROVIDER"),
  model: read("AI_MODEL"),
});

export function apiKeyFor(provider: string): string {
  if (!isPlanProvider(provider)) {
    throw new Error(`Unknown AI provider "${provider}". Known: ${Object.keys(PLAN_PROVIDERS).join(", ")}.`);
  }
  const key = read(KEYS[provider]);
  if (!key) throw new Error(`${KEYS[provider]} is not set. Put it in .env.local and run via \`npm run ai:eval\`, which loads that file.`);
  return key;
}
