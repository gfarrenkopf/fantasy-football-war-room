import { describe, expect, it, vi } from "vitest";
import { fixtureSnapshot } from "../pipeline/fixtures";
import { createClient, SportsDataError } from "./client";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const clientWith = (fetchImpl: typeof fetch) => createClient({ apiKey: "test-key", season: 2026, fetchImpl });

describe("createClient", () => {
  it("sends the key as a header, never in the URL", () => {
    // A key in a query string leaks into logs, referrers and redirects.
    const fetchImpl = vi.fn(async () => ok([]));
    const client = clientWith(fetchImpl as unknown as typeof fetch);
    return client.fantasyPlayers().then(() => {
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).not.toContain("test-key");
      expect((init.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"]).toBe("test-key");
    });
  });

  it("requests the season-scoped projection and bye endpoints", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return ok([]);
    }) as unknown as typeof fetch;
    await clientWith(fetchImpl).snapshot();
    expect(urls.some((u) => u.includes("/PlayerSeasonProjectionStats/2026REG"))).toBe(true);
    expect(urls.some((u) => u.includes("/Byes/2026"))).toBe(true);
  });

  it("returns all three responses from snapshot()", async () => {
    const fixtures = fixtureSnapshot();
    const fetchImpl = (async (url: string) => {
      if (url.includes("FantasyPlayers")) return ok(fixtures.fantasyPlayers);
      if (url.includes("Projection")) return ok(fixtures.projections);
      return ok(fixtures.byes);
    }) as unknown as typeof fetch;

    const snapshot = await clientWith(fetchImpl).snapshot();
    expect(snapshot.fantasyPlayers).toHaveLength(fixtures.fantasyPlayers.length);
    expect(snapshot.projections).toHaveLength(fixtures.projections.length);
    expect(snapshot.byes).toHaveLength(fixtures.byes.length);
  });

  it("explains a 401 as a probable subscription-tier problem", async () => {
    // The actual failure we hit on the free trial, for the injuries endpoint.
    const fetchImpl = (async () => new Response("", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).fantasyPlayers()).rejects.toThrow(/subscription tier/);
  });

  it("carries the endpoint and status on the error", async () => {
    const fetchImpl = (async () => new Response("", { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).byes()).rejects.toMatchObject({
      name: "SportsDataError",
      status: 404,
      endpoint: expect.stringContaining("/Byes/2026"),
    });
  });

  it("wraps a network failure rather than leaking a raw fetch error", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const error = await clientWith(fetchImpl)
      .fantasyPlayers()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SportsDataError);
    expect((error as SportsDataError).message).toContain("network error");
  });
});
