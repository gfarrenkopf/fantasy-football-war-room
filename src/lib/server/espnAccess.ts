export type EspnAccess =
  | { kind: "allowed" }
  /** The beta is limited to ESPN_SYNC_ALLOWLIST and this account isn't on it. */
  | { kind: "not-allowed" }
  /** Payments are on and the league has no season pass. */
  | { kind: "needs-purchase" };

/**
 * Who gets ESPN live draft sync. Pure, so every combination is testable.
 *
 * - ESPN_SYNC_ALLOWLIST set: the beta. Only listed accounts, season pass or not.
 * - Otherwise, payments on: a league with a season pass (the same pass as AI plans).
 * - Otherwise, payments off (self-hosted): everyone signed in.
 */
export async function decideEspnAccess({
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
}): Promise<EspnAccess> {
  if (allowlist.length) return email !== null && allowlist.includes(email.toLowerCase()) ? { kind: "allowed" } : { kind: "not-allowed" };
  if (!paymentsEnabled) return { kind: "allowed" };
  return (await isEntitled()) ? { kind: "allowed" } : { kind: "needs-purchase" };
}
