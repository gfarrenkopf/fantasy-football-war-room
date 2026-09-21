import "server-only";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db/types";
import { hasEntitlement, SEASON_PASS } from "@/lib/server/entitlements";
import { decideEspnAccess, type EspnAccess } from "@/lib/server/espnAccess";

/** Whether this account may use ESPN live sync for this league. See decideEspnAccess(). */
export function espnAccess(db: Db, leagueId: string, email: string | null): Promise<EspnAccess> {
  return decideEspnAccess({
    paymentsEnabled: config.paymentsEnabled,
    allowlist: config.espnSyncAllowlist,
    email,
    isEntitled: () => hasEntitlement(db, leagueId, SEASON_PASS),
  });
}
