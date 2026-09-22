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

const g = globalThis as {
  __espnRelay?: Relay;
  __espnTokenCache?: Map<string, { bridge: VerifiedBridge; until: number }>;
  __espnReverse?: Map<number, Promise<Map<string, number>>>;
};

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

/**
 * The ESPN id of a war room player, for picking him in ESPN from War Room: the crosswalk run
 * backwards over ESPN's player list. Null for a player ESPN's list doesn't match to ours.
 */
export async function espnIdFor(season: number, playerId: string): Promise<number | null> {
  const cache = (g.__espnReverse ??= new Map());
  let pending = cache.get(season);
  if (!pending) {
    pending = getEspnPlayers(season).then((pool) => {
      const walk = buildCrosswalk(pool, dataset.players);
      const reverse = new Map<string, number>();
      for (const p of pool) {
        const r = walk(p.id);
        if (r.kind === "matched" && !reverse.has(r.playerId)) reverse.set(r.playerId, p.id);
      }
      return reverse;
    });
    pending.catch(() => cache.delete(season));
    cache.set(season, pending);
  }
  return (await pending).get(playerId) ?? null;
}
