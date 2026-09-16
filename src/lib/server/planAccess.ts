import { DEFAULT_PLAN_ALLOWANCE } from "./aiPlans";

export type PlanAccess =
  /** May use AI plans, with this many written plans (the first plus rewrites). */
  | { kind: "allowed"; allowance: number }
  /** Payments are off and the account isn't on AI_ALLOWLIST. */
  | { kind: "not-allowed" }
  /** Payments are on and the league has no season pass. */
  | { kind: "needs-purchase" };

/**
 * Who gets AI plans. Pure, so every combination is testable; src/lib/server/ai supplies the inputs.
 *
 * - Payments off (self-hosted, or before launch): AI_ALLOWLIST decides, and an empty list allows everyone.
 * - Payments on: a league with a season pass gets the standard allowance. Emails on AI_ALLOWLIST skip the
 *   paywall (the operator's own testing); an empty list lets no one skip it.
 */
export async function decidePlanAccess({
  paymentsEnabled,
  allowlist,
  email,
  isEntitled,
}: {
  paymentsEnabled: boolean;
  allowlist: readonly string[];
  email: string | null;
  /** Looked up only when payments decide the answer. */
  isEntitled: () => Promise<boolean>;
}): Promise<PlanAccess> {
  const listed = email !== null && allowlist.includes(email.toLowerCase());
  const allowed: PlanAccess = { kind: "allowed", allowance: DEFAULT_PLAN_ALLOWANCE };
  if (!paymentsEnabled) return allowlist.length === 0 || listed ? allowed : { kind: "not-allowed" };
  if (listed || (await isEntitled())) return allowed;
  return { kind: "needs-purchase" };
}
