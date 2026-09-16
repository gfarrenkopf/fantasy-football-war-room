import "server-only";
import type { PlanModel } from "@/lib/ai/provider";
import { createPlanModel, isPlanProvider } from "@/lib/ai/providers";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db/types";
import { hasEntitlement, SEASON_PASS } from "@/lib/server/entitlements";
import { decidePlanAccess, type PlanAccess } from "@/lib/server/planAccess";

/** The configured plan model, or null when AI plans are off. */
export function getPlanModel(): PlanModel | null {
  if (!config.aiEnabled || !config.aiApiKey || !isPlanProvider(config.aiProvider)) return null;
  return createPlanModel(config.aiProvider, {
    apiKey: config.aiApiKey,
    model: config.aiModel,
  });
}

/** Whether this account may use AI plans for this league, and how many it may have written. See decidePlanAccess(). */
export function planAccess(db: Db, leagueId: string, email: string | null): Promise<PlanAccess> {
  return decidePlanAccess({
    paymentsEnabled: config.paymentsEnabled,
    allowlist: config.aiAllowlist,
    email,
    isEntitled: () => hasEntitlement(db, leagueId, SEASON_PASS),
  });
}
