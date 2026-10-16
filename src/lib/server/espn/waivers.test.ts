import { beforeEach, describe, expect, it, vi } from "vitest";
import freeAgents from "@/lib/season/__fixtures__/espn-free-agents-2026.json";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import projections from "@/lib/season/__fixtures__/espn-projections-2026.json";
import { parseSeasonLeague } from "@/lib/season/espnLeague";
import { parseProjections } from "@/lib/season/projections";
import { buildSeasonView } from "@/lib/season/view";

vi.mock("server-only", () => ({}));
const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const view = buildSeasonView(parsed.league, 1, new Map(parseProjections(projections, 2026).map((p) => [p.id, p])));

type Filter = { players: Record<string, unknown> & { limit: number; offset?: number; filterIds?: { value: number[] } } };
const state = vi.hoisted(() => ({ filters: [] as unknown[], fail: false, deep: false }));
vi.mock("./seasonView", () => ({ loadSeasonView: async () => ({ kind: "ok", view }) }));
vi.mock("./seasonData", () => ({ loadSeason: async () => ({ kind: "ok", league: parsed.league, espnTeamId: 1, fetchedAt: new Date(), stale: false }) }));
vi.mock("./logins", () => ({ loadLogin: async () => ({ espnS2: "s2", swid: "{SWID}" }) }));
vi.mock("./projections", () => ({ getEspnProjections: async () => new Map() }));
vi.mock("./scoreboard", () => ({ getEspnScoreboard: async () => new Map() }));
vi.mock("./sessionCheck", () => ({ confirmSignedOut: async () => false }));
/** ESPN's pool, the eight-player capture, paged and narrowed by id the way ESPN does it. */
vi.mock("./leagueReader", () => ({
  readEspnLeague: async (_login: unknown, { filter }: { filter: Filter }) => {
    state.filters.push(filter);
    if (state.fail) return { ok: false, reason: "unavailable", detail: "503" };
    const { limit, offset = 0, filterIds } = filter.players;
    // `deep`: the capture repeated under new ids, for a pool longer than a page.
    const all = state.deep ? Array.from({ length: 120 }, (_, i) => ({ ...freeAgents.players[i % 8], id: 100 + i })) : freeAgents.players;
    const pool = filterIds ? all.filter((p) => filterIds.value.includes(p.id)) : all;
    return { ok: true, data: { players: pool.slice(offset, offset + limit) } };
  },
}));

const KEY = Buffer.alloc(32);
let user = 0;
beforeEach(() => {
  state.filters = [];
  state.fail = false;
  state.deep = false;
  user++;
});

describe("freeAgentFilter", () => {
  it("adds ESPN's name filter and offset only when searching", async () => {
    const { freeAgentFilter } = await import("./waivers");
    expect(freeAgentFilter(2026, 6, [17], 26, { name: "bass", offset: 25 }).players).toMatchObject({ filterSlotIds: { value: [17] }, filterName: { value: "bass" }, limit: 26, offset: 25 });
    const plain = freeAgentFilter(2026, 6).players;
    expect(plain).not.toHaveProperty("filterName");
    expect(plain).not.toHaveProperty("offset");
  });
});

describe("searchPlayers", () => {
  it("asks ESPN for one more than a page, at the position and name searched, and values every player", async () => {
    const { SEARCH_PAGE, searchPlayers } = await import("./waivers");
    const load = await searchPlayers({} as never, KEY, `u${user}`, "l1", { name: "Joe", position: "QB" });
    expect(state.filters[0]).toMatchObject({ players: { filterSlotIds: { value: [0] }, filterName: { value: "Joe" }, limit: SEARCH_PAGE + 1 } });
    if (load.kind !== "ok") throw new Error(load.kind);
    expect(load.more).toBe(false);
    expect(load.players.map((p) => p.player.name)).toEqual(freeAgents.players.map((p) => p.player.fullName));
    for (const p of load.players) expect(p).toEqual(expect.objectContaining({ delta: expect.any(Number), perWeek: expect.any(Number) }));
  });

  it("pages with ESPN's offset, and says another page follows when ESPN has more than a page", async () => {
    const { SEARCH_PAGE, searchPlayers } = await import("./waivers");
    const tail = await searchPlayers({} as never, KEY, `u${user}`, "l1", { offset: 7 });
    expect(state.filters[0]).toMatchObject({ players: { offset: 7 } });
    if (tail.kind !== "ok") throw new Error(tail.kind);
    expect(tail.players).toHaveLength(1);
    expect(tail.more).toBe(false);

    state.deep = true;
    const full = await searchPlayers({} as never, KEY, `u${user}`, "l1", {});
    if (full.kind !== "ok") throw new Error(full.kind);
    expect(full.players).toHaveLength(SEARCH_PAGE);
    expect(full.more).toBe(true);
  });

  it("serves a repeated search from the cache, and answers a problem when ESPN fails cold", async () => {
    const { searchPlayers } = await import("./waivers");
    await searchPlayers({} as never, KEY, `u${user}`, "l1", { name: "Kit" });
    await searchPlayers({} as never, KEY, `u${user}`, "l1", { name: "kit" });
    expect(state.filters).toHaveLength(1);
    state.fail = true;
    expect(await searchPlayers({} as never, KEY, `u${user}`, "l1", { name: "Purdy" })).toEqual({ kind: "problem", problem: "unavailable" });
  });
});

describe("browsing from the wire's pool", () => {
  it("serves a position without a name from the pool the tab read, with no ESPN read", async () => {
    const { loadWaivers, searchPlayers } = await import("./waivers");
    await loadWaivers({} as never, KEY, `u${user}`, "l1");
    expect(state.filters).toHaveLength(1);
    const load = await searchPlayers({} as never, KEY, `u${user}`, "l1", { position: "QB" });
    if (load.kind !== "ok") throw new Error(load.kind);
    expect(state.filters).toHaveLength(1);
    expect(load.players.map((p) => p.player.name)).toEqual(freeAgents.players.filter((p) => p.player.defaultPositionId === 1).map((p) => p.player.fullName));
    expect(load.more).toBe(false);
  });

  it("reads ESPN for a name, and past a pool that runs out before the page does", async () => {
    const { loadWaivers, searchPlayers } = await import("./waivers");
    state.deep = true;
    await loadWaivers({} as never, KEY, `u${user}`, "l1");
    await searchPlayers({} as never, KEY, `u${user}`, "l1", { name: "Joe" });
    await searchPlayers({} as never, KEY, `u${user}`, "l1", { offset: 95 });
    expect(state.filters).toHaveLength(3);
  });
});

describe("availablePlayer", () => {
  it("finds a searched player in the cache, and reads one by id from ESPN once it isn't cached", async () => {
    const { availablePlayer, searchPlayers } = await import("./waivers");
    const [burrow, kittle] = freeAgents.players;
    await searchPlayers({} as never, KEY, `u${user}`, "l1", { name: "Joe" });
    state.filters = [];
    expect(await availablePlayer({} as never, KEY, `u${user}`, "l1", burrow.id)).toMatchObject({ name: "Joe Burrow", status: "FREEAGENT" });
    expect(state.filters).toHaveLength(0);

    expect(await availablePlayer({} as never, KEY, `u${user}`, "l2", kittle.id)).toMatchObject({ name: "George Kittle" });
    expect(state.filters[0]).toMatchObject({ players: { filterIds: { value: [kittle.id] }, filterStatus: { value: ["FREEAGENT", "WAIVERS"] } } });
    expect(await availablePlayer({} as never, KEY, `u${user}`, "l2", 1)).toBeNull();
  });
});
