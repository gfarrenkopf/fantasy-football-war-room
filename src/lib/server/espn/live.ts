import "server-only";
import { dataset } from "@/lib/data";
import type { Db } from "@/lib/db/types";
import { buildCrosswalk } from "@/lib/espn/crosswalk";
import { verifyBridgeToken, type VerifiedBridge } from "./bridgeTokens";
import { getEspnPlayers } from "./players";
import { createRelay, type Relay } from "./relay";

/**
 * The process-wide relay and the bridge's token check. One Next process serves the hosted app
 * (deploy/warroom.service), so in-memory state is shared by every request; it lives on globalThis
 * so dev hot reloads don't split it, like the db pool.
 */

const g = globalThis as { __espnRelay?: Relay; __espnTokenCache?: Map<string, { bridge: VerifiedBridge; until: number }> };

export function getRelay(): Relay {
  return (g.__espnRelay ??= createRelay({
    crosswalkFor: async (season) => buildCrosswalk(await getEspnPlayers(season), dataset.players),
    fallbackCrosswalk: buildCrosswalk([], dataset.players),
  }));
}

/** How long a verified token is trusted without asking the database again. The bridge posts every 250ms. */
const TOKEN_CACHE_MS = 60_000;

/** The bridge token's scope, cached briefly: a token revoked or expired mid-cache still works for up to a minute. */
export async function verifyBridge(db: Db, token: string, now = Date.now()): Promise<VerifiedBridge | null> {
  const cache = (g.__espnTokenCache ??= new Map());
  const hit = cache.get(token);
  if (hit && hit.until > now && hit.bridge.expiresAt.getTime() > now) return hit.bridge;
  const bridge = await verifyBridgeToken(db, token, new Date(now));
  if (cache.size > 1000) cache.clear();
  if (bridge) cache.set(token, { bridge, until: now + TOKEN_CACHE_MS });
  else cache.delete(token);
  return bridge;
}
