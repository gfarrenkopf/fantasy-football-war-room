import { describe, expect, it } from "vitest";
import { NO_PLAN, nextPollDelay, parsePlanView, type PlanView } from "@/lib/ai/planView";
import { createAiPlanStore } from "./aiPlan";

const generating: PlanView = {
  ...NO_PLAN,
  status: "generating",
  requestedAt: "2026-09-16T00:00:00.000Z",
  startedAt: "2026-09-16T00:00:01.000Z",
};

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; method: string }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET" });
    return respond(url, init);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("AI plan store", () => {
  it("returns the paywall view when the league needs a season pass (402)", async () => {
    const { fetch } = fakeFetch(() => Response.json({ ...NO_PLAN, needsPurchase: true }, { status: 402 }));
    const store = createAiPlanStore({ fetch, flush: async () => true });
    expect(await store.request("l1")).toEqual({ ok: true, view: { ...NO_PLAN, needsPurchase: true } });
  });

  it("flushes league edits before asking for a plan, then returns the job", async () => {
    const order: string[] = [];
    const { fetch, calls } = fakeFetch(() => {
      order.push("POST");
      return Response.json(generating, { status: 202 });
    });
    const store = createAiPlanStore({
      fetch,
      flush: async () => (order.push("flush"), true),
    });
    expect(await store.request("league 1")).toEqual({
      ok: true,
      view: generating,
    });
    expect(order).toEqual(["flush", "POST"]);
    expect(calls).toEqual([{ url: "/api/leagues/league%201/plan", method: "POST" }]);
  });

  it("sends regenerate requests as a JSON body, and plain requests without one", async () => {
    const bodies: (string | undefined)[] = [];
    const { fetch } = fakeFetch((_url, init) => {
      bodies.push(init.body as string | undefined);
      return Response.json({ ...generating, regenerationsLeft: 2, limitReached: true });
    });
    const store = createAiPlanStore({ fetch, flush: async () => true });
    const regenerated = await store.request("l1", { regenerate: true });
    await store.request("l1");
    expect(bodies).toEqual(['{"regenerate":true}', undefined]);
    expect(regenerated).toMatchObject({ ok: true, view: { regenerationsLeft: 2, limitReached: true } });
  });

  it("doesn't ask when league edits can't sync", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(generating));
    const store = createAiPlanStore({ fetch, flush: async () => false });
    expect(await store.request("l1")).toEqual({ ok: false, reason: "offline" });
    expect(calls).toEqual([]);
  });

  it("maps failures to reasons the UI can explain", async () => {
    const respond = (status: number, body: unknown = { error: "nope" }) =>
      createAiPlanStore({
        fetch: fakeFetch(() => Response.json(body, { status })).fetch,
        flush: async () => true,
      });
    expect(await respond(401).get("l1")).toEqual({
      ok: false,
      reason: "signed-out",
    });
    expect(await respond(403).request("l1")).toEqual({
      ok: false,
      reason: "unavailable",
      message: "nope",
    });
    expect(await respond(404).get("l1")).toEqual({ ok: true, view: NO_PLAN });
    expect(await respond(404).request("l1")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await respond(422).request("l1")).toEqual({
      ok: false,
      reason: "invalid-league",
      message: "nope",
    });
    expect(await respond(502).get("l1")).toEqual({
      ok: false,
      reason: "offline",
    });
    expect(await respond(200, { status: "bogus" }).get("l1")).toEqual({
      ok: false,
      reason: "offline",
    });
    const unreachable = createAiPlanStore({
      fetch: fakeFetch(() => Promise.reject(new TypeError("fetch failed"))).fetch,
      flush: async () => true,
    });
    expect(await unreachable.get("l1")).toEqual({
      ok: false,
      reason: "offline",
    });
  });
});

describe("plan polling", () => {
  it("polls quickly at first, eases off after a minute, and stops when the job is done", () => {
    expect(nextPollDelay(generating, 5_000)).toBe(3_000);
    expect(nextPollDelay({ ...generating, status: "queued" }, 90_000)).toBe(10_000);
    for (const status of ["none", "ready", "failed"] as const) expect(nextPollDelay({ ...generating, status }, 0)).toBeNull();
  });

  it("parses a view and rejects anything else", () => {
    expect(parsePlanView(JSON.parse(JSON.stringify(generating)))).toEqual(generating);
    expect(parsePlanView({ ...generating, plan: { intro: 1 } })).toBeNull();
    expect(parsePlanView(null)).toBeNull();
  });
});
