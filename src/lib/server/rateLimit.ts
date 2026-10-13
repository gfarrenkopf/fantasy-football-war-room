/**
 * A fixed-window rate limiter held in memory. The hosted app is one Node process on one droplet
 * (docs/deployment.md), so memory is shared by every request; a restart forgets the counts, which
 * is fine for slowing down guessing, the only thing it's for.
 */
export function rateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    /** Counts a request for `key` and says whether it's within the limit. */
    allow(key: string, now = Date.now()): boolean {
      const hit = hits.get(key);
      if (!hit || now - hit.start >= windowMs) {
        // Sweep stale windows now and then, so the map can't grow without bound.
        if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        hits.set(key, { start: now, count: 1 });
        return true;
      }
      hit.count += 1;
      return hit.count <= limit;
    },
  };
}

/** The client's address, for rate-limit keys. Caddy's reverse_proxy (deploy/Caddyfile) sets X-Forwarded-For to it. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
