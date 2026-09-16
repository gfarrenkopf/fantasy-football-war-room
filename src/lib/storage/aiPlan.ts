import { NO_PLAN, parsePlanView, type PlanView } from "@/lib/ai/planView";
import type { AiPlanResult, AiPlanStore } from "./types";

/**
 * The AI plan API for a signed-in user. Unlike leagues and drafts there's nothing to cache or queue:
 * the plan is written on the server, and the UI polls `get` while a job runs.
 */
export function createAiPlanStore({
  fetch: doFetch,
  flush,
  timeoutMs = 15_000,
}: {
  fetch: typeof fetch;
  /** Pushes unsynced league edits, so the server writes the plan for the settings the user sees. */
  flush: () => Promise<boolean>;
  timeoutMs?: number;
}): AiPlanStore {
  const path = (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/plan`;

  async function call(method: "GET" | "POST", leagueId: string, payload?: unknown): Promise<AiPlanResult> {
    let response: Response;
    try {
      response = await doFetch(path(leagueId), {
        method,
        ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, reason: "offline" };
    }
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { error?: unknown } | null)?.error;
    if (response.ok) {
      const view = parsePlanView(body);
      return view ? { ok: true, view } : { ok: false, reason: "offline" };
    }
    if (response.status === 401) return { ok: false, reason: "signed-out" };
    if (response.status === 403)
      return {
        ok: false,
        reason: "unavailable",
        message: typeof message === "string" ? message : undefined,
      };
    // The league isn't on the server (yet): nothing to show.
    if (response.status === 404 && method === "GET") return { ok: true, view: NO_PLAN };
    if (response.status === 404) return { ok: false, reason: "not-found" };
    if (response.status === 422)
      return {
        ok: false,
        reason: "invalid-league",
        message: typeof message === "string" ? message : undefined,
      };
    return { ok: false, reason: "offline" };
  }

  return {
    get: (leagueId) => call("GET", leagueId),
    async request(leagueId, { regenerate = false } = {}) {
      if (!(await flush())) return { ok: false, reason: "offline" };
      return call("POST", leagueId, regenerate ? { regenerate: true } : undefined);
    },
  };
}

export type { PlanView };
