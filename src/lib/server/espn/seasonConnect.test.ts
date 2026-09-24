import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_SEASON_VERSION } from "@/lib/espn/disclosure";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import { deleteLeague, findLeague } from "../leagues";
import { createTestLeague } from "../testLeagues";
import { mintBridgeToken } from "./bridgeTokens";
import { loadLogin, loginStatus } from "./logins";
import { findSeasonLink, linkSeason, listSeasonLinks } from "./seasonLinks";

vi.mock("server-only", () => ({}));
const { connectSeason } = await import("./seasonConnect");

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const KEY = randomBytes(32);
const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";
const request = { espnLeagueId: "110222051", season: 2026, consentVersion: ESPN_SEASON_VERSION, espnS2: "AEB%2Fnot-a-real-cookie", swid: SWID };
/** ESPN's answer: the fixture league's settings, with the user owning team 3. */
const espnLeague = { settings: league.settings, teams: [{ id: 1, owners: ["{AAAAAAAA-0000-0000-0000-000000000000}"] }, { id: 3, owners: [SWID.toLowerCase()] }] };

function espn(status = 200, body: unknown = espnLeague) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe("connectSeason", () => {
  it("checks the login against ESPN, stores it, and builds a war room league from ESPN's settings", async () => {
    const userId = await createTestUser(db);
    const fetchImpl = espn();
    const result = await connectSeason(db, KEY, userId, request, { fetchImpl });
    expect(result).toMatchObject({ ok: true, espnTeamId: 3, created: true });
    if (!result.ok) return;

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/seasons/2026/segments/0/leagues/110222051?view=mSettings&view=mTeam");
    expect((init?.headers as Record<string, string>).Cookie).toBe(`espn_s2=${request.espnS2}; SWID=${SWID}`);

    expect(await loadLogin(db, KEY, userId)).toEqual({ espnS2: request.espnS2, swid: SWID });
    expect((await loginStatus(db, userId))?.verifiedAt).not.toBeNull();
    const row = await findLeague(db, userId, result.leagueId);
    expect(row).toMatchObject({ name: "App Test 8.17" });
    expect(row!.settings).toMatchObject({ teams: 4, scoring: "ppr" });
    expect(await findSeasonLink(db, userId, result.leagueId)).toEqual({ leagueId: result.leagueId, espnLeagueId: "110222051", espnTeamId: 3, season: 2026 });

    // Connecting again finds the same league rather than building another.
    expect(await connectSeason(db, KEY, userId, request, { fetchImpl: espn() })).toMatchObject({ ok: true, leagueId: result.leagueId, created: false });
  });

  it("links the league the user paired with this ESPN league for the draft", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    await mintBridgeToken(db, { userId, leagueId, espnLeagueId: "110222051", espnTeamId: 3, season: 2026 });
    expect(await connectSeason(db, KEY, userId, request, { fetchImpl: espn() })).toMatchObject({ ok: true, leagueId, created: false });
  });

  it("refuses without storing anything when ESPN won't read the league, or the user has no team in it", async () => {
    const userId = await createTestUser(db);
    expect(await connectSeason(db, KEY, userId, request, { fetchImpl: espn(401, {}) })).toMatchObject({ ok: false, status: 400 });
    expect(await connectSeason(db, KEY, userId, request, { fetchImpl: espn(404, {}) })).toMatchObject({ ok: false, status: 404 });
    expect(await connectSeason(db, KEY, userId, request, { fetchImpl: espn(200, { ...espnLeague, teams: [] }) })).toMatchObject({ ok: false, status: 403 });
    expect(await loginStatus(db, userId)).toBeNull();
  });

  it("asks for consent again when the version the user saw is out of date", async () => {
    const userId = await createTestUser(db);
    const fetchImpl = espn();
    expect(await connectSeason(db, KEY, userId, { ...request, consentVersion: 0 }, { fetchImpl })).toMatchObject({
      ok: false,
      status: 409,
      seasonVersion: ESPN_SEASON_VERSION,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a roster War Room can't represent", async () => {
    const userId = await createTestUser(db);
    const idp = { ...espnLeague, settings: { ...league.settings, rosterSettings: { lineupSlotCounts: { ...league.settings.rosterSettings.lineupSlotCounts, "11": 1 } } } };
    expect(await connectSeason(db, KEY, userId, request, { fetchImpl: espn(200, idp) })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("linebacker") });
  });
});

describe("listSeasonLinks", () => {
  it("lists the user's live linked leagues, most recently connected first", async () => {
    const userId = await createTestUser(db);
    const older = await createTestLeague(db, userId);
    const newer = await createTestLeague(db, userId);
    const gone = await createTestLeague(db, userId);
    await linkSeason(db, userId, { leagueId: older, espnLeagueId: "1", espnTeamId: 1, season: 2026 }, new Date("2026-09-01"));
    await linkSeason(db, userId, { leagueId: newer, espnLeagueId: "2", espnTeamId: 1, season: 2026 }, new Date("2026-09-20"));
    await linkSeason(db, userId, { leagueId: gone, espnLeagueId: "3", espnTeamId: 1, season: 2026 }, new Date("2026-09-21"));
    await deleteLeague(db, userId, gone);
    expect((await listSeasonLinks(db, userId)).map((l) => l.leagueId)).toEqual([newer, older]);
    expect(await listSeasonLinks(db, await createTestUser(db))).toEqual([]);
  });
});
