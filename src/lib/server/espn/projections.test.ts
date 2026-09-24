import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createProjectionSource } = await import("./projections");

const row = (id: number) => ({
  player: { id, fullName: `Player ${id}`, defaultPositionId: 2, proTeamId: 8, stats: [{ statSourceId: 1, statSplitTypeId: 1, seasonId: 2026, scoringPeriodId: 3, stats: { "53": id } }] },
});
const ok = (ids: number[]) => new Response(JSON.stringify({ players: ids.map(row) }), { status: 200 });
const idsIn = (init: RequestInit | undefined): number[] =>
  JSON.parse((init?.headers as Record<string, string>)["X-Fantasy-Filter"]).players.filterIds.value;

function setup(respond: (ids: number[]) => Response = ok) {
  let t = 0;
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => respond(idsIn(init)));
  const source = createProjectionSource({ fetchImpl, now: () => t, ttlMs: 1000 });
  return { source, fetchImpl, advance: (ms: number) => (t += ms) };
}

const query = (playerIds: number[], extra = {}) => ({ season: 2026, playerIds, fromWeek: 3, toWeek: 17, ...extra });

describe("createProjectionSource", () => {
  it("fetches the public view for the requested players and weeks, then serves them from cache", async () => {
    const { source, fetchImpl } = setup();
    const first = await source(query([1, 2]));
    expect([...first.keys()]).toEqual([1, 2]);
    expect(first.get(2)!.weeks.get(3)).toEqual({ "53": 2 });
    await source(query([2, 1]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/leaguedefaults/3?view=kona_player_info");
    expect(JSON.parse((init?.headers as Record<string, string>)["X-Fantasy-Filter"]).players.filterStatsForTopScoringPeriodIds.additionalValue).toHaveLength(15);
  });

  it("fetches only the players it doesn't have, in batches of 100", async () => {
    const { source, fetchImpl } = setup();
    await source(query([1]));
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    expect((await source(query(ids))).size).toBe(150);
    expect(fetchImpl.mock.calls.slice(1).map(([, init]) => idsIn(init).length)).toEqual([100, 49]);
  });

  it("refetches after the ttl, sooner with maxAgeMs, and when the week range moves on", async () => {
    const { source, fetchImpl, advance } = setup();
    await source(query([1]));
    advance(500);
    await source(query([1]));
    await source(query([1], { maxAgeMs: 100 }));
    await source(query([1], { fromWeek: 4 }));
    advance(1000);
    await source(query([1], { fromWeek: 4 }));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("serves stale projections when a refresh fails, and throws when it has none", async () => {
    let down = false;
    const { source, advance } = setup((ids) => (down ? new Response("no", { status: 503 }) : ok(ids)));
    await source(query([1]));
    advance(2000);
    down = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await source(query([1]))).has(1)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[espn-sync]"));
    warn.mockRestore();
    await expect(source(query([1, 2]))).rejects.toThrow("HTTP 503");
  });

  it("leaves out players ESPN doesn't return", async () => {
    const { source } = setup(() => ok([1]));
    expect([...(await source(query([1, 99]))).keys()]).toEqual([1]);
  });
});
