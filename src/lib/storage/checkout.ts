import type { CheckoutStore } from "./types";

/** Starts a season pass purchase for a signed-in user. The page then navigates to Stripe. */
export function createCheckoutStore({
  fetch: doFetch,
  flush,
  timeoutMs = 15_000,
}: {
  fetch: typeof fetch;
  /** Pushes unsynced edits first: the server can only sell a pass for a league it has. */
  flush: () => Promise<boolean>;
  timeoutMs?: number;
}): CheckoutStore {
  return {
    async start(leagueId) {
      if (!(await flush())) return { ok: false, reason: "offline" };
      let response: Response;
      try {
        response = await doFetch(`/api/leagues/${encodeURIComponent(leagueId)}/checkout`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { ok: false, reason: "offline" };
      }
      const body: unknown = await response.json().catch(() => null);
      const url = (body as { url?: unknown } | null)?.url;
      if (response.ok) return typeof url === "string" ? { ok: true, url } : { ok: false, reason: "unavailable" };
      if (response.status === 401) return { ok: false, reason: "signed-out" };
      if (response.status === 404) return { ok: false, reason: "not-found" };
      if (response.status === 409) return { ok: false, reason: "already-paid" };
      return { ok: false, reason: "unavailable" };
    },
  };
}
