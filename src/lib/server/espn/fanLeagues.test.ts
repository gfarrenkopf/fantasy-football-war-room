import { describe, expect, it, vi } from "vitest";
import { listFanLeagues, parseFanLeagues } from "./fanLeagues";

/** The fan API's shape (APE-368), trimmed: two fantasy football leagues, another game, and a non-fantasy preference. */
const preferences = [
  { typeId: 9, metaData: { entry: { abbrev: "FFL", seasonId: 2026, entryId: 3, entryMetadata: { teamName: "The Goats" }, groups: [{ groupId: 704343562, groupName: "App Tester" }] } } },
  { typeId: 9, metaData: { entry: { abbrev: "FFL", seasonId: 2025, entryId: 1, entryMetadata: {}, groups: [{ groupId: 111, groupName: "Old League" }] } } },
  { typeId: 9, metaData: { entry: { abbrev: "FFL", seasonId: 2026, entryId: 6, entryMetadata: { teamName: "Bench Mob" }, groups: [{ groupId: 222, groupName: "Another League" }] } } },
  { typeId: 9, metaData: { entry: { abbrev: "FBA", seasonId: 2026, entryId: 2, groups: [{ groupId: 333, groupName: "Hoops" }] } } },
  { typeId: 1, metaData: { entry: { abbrev: "FFL" } } },
  { typeId: 9, metaData: { entry: { abbrev: "FFL", seasonId: 2026, entryId: 3, groups: [{ groupId: 704343562, groupName: "App Tester" }] } } },
];

describe("parseFanLeagues", () => {
  it("keeps fantasy football leagues once each, newest season first, then by name", () => {
    expect(parseFanLeagues(preferences)).toEqual([
      { espnLeagueId: "222", name: "Another League", season: 2026, espnTeamId: 6, teamName: "Bench Mob" },
      { espnLeagueId: "704343562", name: "App Tester", season: 2026, espnTeamId: 3, teamName: "The Goats" },
      { espnLeagueId: "111", name: "Old League", season: 2025, espnTeamId: 1, teamName: null },
    ]);
  });

  it("skips entries without a league id or team", () => {
    expect(parseFanLeagues([{ typeId: 9, metaData: { entry: { abbrev: "FFL", seasonId: 2026, groups: [{}] } } }, null as never])).toEqual([]);
  });
});

describe("listFanLeagues", () => {
  const login = { espnS2: "AEB%2Fnot-real", swid: "{154E132F-8C13-4AC0-9DAC-20C2C5625594}" };

  it("asks the fan API with the login's cookies", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ preferences }));
    const result = await listFanLeagues(login, { fetchImpl });
    expect(result.ok && result.leagues).toHaveLength(3);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain(`/apis/v2/fans/${encodeURIComponent(login.swid)}`);
    expect((init?.headers as Record<string, string>).Cookie).toBe(`espn_s2=${login.espnS2}; SWID=${login.swid}`);
  });

  it("tells a rejected login from ESPN being down", async () => {
    expect(await listFanLeagues(login, { fetchImpl: async () => new Response("", { status: 401 }) })).toEqual({ ok: false, reason: "auth" });
    expect(await listFanLeagues(login, { fetchImpl: async () => new Response("", { status: 500 }) })).toEqual({ ok: false, reason: "unreachable" });
    expect(await listFanLeagues(login, { fetchImpl: async () => Promise.reject(new Error("offline")) })).toEqual({ ok: false, reason: "unreachable" });
  });
});
