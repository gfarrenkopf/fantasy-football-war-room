import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createPlayerSource } = await import("./players");

const row = { id: 1, fullName: "Jahmyr Gibbs", proTeamId: 8, defaultPositionId: 2 };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function setup(responses: (() => Response)[]) {
  let t = 0;
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("network down");
    return next();
  });
  const source = createPlayerSource({ fetchImpl, now: () => t, ttlMs: 1000 });
  return { source, fetchImpl, advance: (ms: number) => (t += ms) };
}

describe("createPlayerSource", () => {
  it("fetches the season's active players with the filter header, and caches them", async () => {
    const { source, fetchImpl } = setup([() => ok([row])]);
    expect(await source(2026)).toEqual([row]);
    expect(await source(2026)).toEqual([row]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/seasons/2026/players?view=players_wl");
    expect((init?.headers as Record<string, string>)["X-Fantasy-Filter"]).toContain("filterActive");
  });

  it("shares one request between concurrent callers", async () => {
    const { source, fetchImpl } = setup([() => ok([row])]);
    await Promise.all([source(2026), source(2026), source(2026)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes after the ttl, and serves the stale list if the refresh fails", async () => {
    const { source, fetchImpl, advance } = setup([() => ok([row]), () => new Response("nope", { status: 503 })]);
    await source(2026);
    advance(2000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await source(2026)).toEqual([row]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[espn-sync]"));
    warn.mockRestore();
  });

  it("throws when there's nothing cached to fall back on", async () => {
    const { source } = setup([]);
    await expect(source(2026)).rejects.toThrow("network down");
  });

  it("caches each season separately", async () => {
    const { source, fetchImpl } = setup([() => ok([row]), () => ok([])]);
    expect(await source(2026)).toEqual([row]);
    expect(await source(2027)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
