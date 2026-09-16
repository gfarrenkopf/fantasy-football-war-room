import { describe, expect, it } from "vitest";
import { createCheckoutStore } from "./checkout";

function fakeFetch(respond: () => Response) {
  const calls: { url: string; method: string }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET" });
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("checkout store", () => {
  it("flushes league edits, then returns the Stripe URL", async () => {
    const order: string[] = [];
    const { fetch, calls } = fakeFetch(() => (order.push("POST"), Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test" })));
    const store = createCheckoutStore({ fetch, flush: async () => (order.push("flush"), true) });
    expect(await store.start("league 1")).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test" });
    expect(order).toEqual(["flush", "POST"]);
    expect(calls).toEqual([{ url: "/api/leagues/league%201/checkout", method: "POST" }]);
  });

  it("doesn't call the server when league edits can't sync", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({}));
    const store = createCheckoutStore({ fetch, flush: async () => false });
    expect(await store.start("l1")).toEqual({ ok: false, reason: "offline" });
    expect(calls).toEqual([]);
  });

  it.each([
    [401, "signed-out"],
    [404, "not-found"],
    [409, "already-paid"],
    [503, "unavailable"],
    [500, "unavailable"],
  ] as const)("maps %i to %s", async (status, reason) => {
    const { fetch } = fakeFetch(() => Response.json({ error: "nope" }, { status }));
    const store = createCheckoutStore({ fetch, flush: async () => true });
    expect(await store.start("l1")).toEqual({ ok: false, reason });
  });

  it("treats an unreachable server, or a response without a URL, as a failure", async () => {
    const offline = createCheckoutStore({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      flush: async () => true,
    });
    expect(await offline.start("l1")).toEqual({ ok: false, reason: "offline" });
    const { fetch } = fakeFetch(() => Response.json({}));
    expect(await createCheckoutStore({ fetch, flush: async () => true }).start("l1")).toEqual({ ok: false, reason: "unavailable" });
  });
});
