import "server-only";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db/types";
import { hasEntitlement, SEASON_PASS } from "@/lib/server/entitlements";
import { decideEspnAccess, type EspnAccess } from "@/lib/server/espnAccess";
import { decideSeasonAccess, seasonAccessStamp } from "./seasonAccess";

/** Whether this account may use ESPN live sync for this league. See decideEspnAccess(). */
export function espnAccess(db: Db, leagueId: string, email: string | null): Promise<EspnAccess> {
  return decideEspnAccess({
    paymentsEnabled: config.paymentsEnabled,
    allowlist: config.espnSyncAllowlist,
    email,
    isEntitled: () => hasEntitlement(db, leagueId, SEASON_PASS),
  });
}

/** Whether this account may use in-season features. See decideSeasonAccess(). */
export function mayUseSeason(db: Db, userId: string | null, email: string | null): Promise<boolean> {
  return decideSeasonAccess({
    mode: config.seasonAccess,
    allowlist: config.seasonAllowlist,
    email,
    stamped: async () => userId !== null && (await seasonAccessStamp(db, userId)) !== null,
  });
}
