import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import { findLeague, putDraft } from "../leagues";
import { createTestLeague } from "../testLeagues";
import { loginStatus, storeLogin } from "./logins";
import { linkSeason } from "./seasonLinks";

vi.mock("server-only", () => ({}));
const { createSeasonLoader } = await import("./seasonData");

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const KEY = randomBytes(32);
const LOGIN = { espnS2: "AEB%2Fnot-real", swid: "{154E132F-8C13-4AC0-9DAC-20C2C5625594}" };

async function connectedLeague() {
  const userId = await createTestUser(db);
  const leagueId = await createTestLeague(db, userId);
  await storeLogin(db, KEY, userId, LOGIN, { season: 2026, consentVersion: 1 });
  await linkSeason(db, userId, { leagueId, espnLeagueId: "110222051", espnTeamId: 1, season: 2026 });
  return { userId, leagueId };
}

function setup(respond: () => Response = () => new Response(JSON.stringify(league))) {
  let t = new Date("2026-09-24T12:00:00Z").getTime();
  const fetchImpl = vi.fn<typeof fetch>(async () => respond());
  const load = createSeasonLoader({ fetchImpl, now: () => new Date(t), ttlMs: 1000 });
  return { load, fetchImpl, advance: (ms: number) => (t += ms) };
}

describe("the season loader", () => {
  it("reads every roster with the stored login, and caches it for a few minutes", async () => {
    const { userId, leagueId } = await connectedLeague();
    const { load, fetchImpl, advance } = setup();
    const first = await load(db, KEY, userId, leagueId);
    expect(first).toMatchObject({ kind: "ok", espnTeamId: 1, stale: false });
    expect(first.kind === "ok" && first.league.teams).toHaveLength(4);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/leagues/110222051?view=mSettings&view=mStatus&view=mRoster&view=mTeam&view=mPendingTransactions");
    expect((init?.headers as Record<string, string>).Cookie).toContain(LOGIN.espnS2);
    expect((await loginStatus(db, userId))?.verifiedAt).not.toBeNull();

    await load(db, KEY, userId, leagueId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await load(db, KEY, userId, leagueId, { refresh: true });
    advance(2000);
    await load(db, KEY, userId, leagueId);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("follows ESPN's settings and name on a fresh read; a final draft keeps its board's shape (APE-330)", async () => {
    const half = {
      ...league,
      settings: {
        ...league.settings,
        name: "Renamed on ESPN",
        scoringSettings: { ...league.settings.scoringSettings, scoringItems: [{ statId: 53, points: 0.5 }] },
      },
    };
    const open = await connectedLeague();
    const { load } = setup(() => new Response(JSON.stringify(half)));
    await load(db, KEY, open.userId, open.leagueId);
    const followed = await findLeague(db, open.userId, open.leagueId);
    expect(followed).toMatchObject({ name: "Renamed on ESPN", espn: { espnLeagueId: "110222051", espnTeamId: 1, season: 2026 } });
    expect(followed!.settings).toMatchObject({ teams: 4, scoring: "half", valueThreshold: 10 });

    const final = await connectedLeague();
    const before = (await findLeague(db, final.userId, final.leagueId))!.settings;
    await putDraft(db, final.userId, final.leagueId, { version: 1, picks: [], final: { source: "espn", at: "2026-09-06T20:00:00.000Z" } }, 0, { server: true });
    await setup(() => new Response(JSON.stringify(half))).load(db, KEY, final.userId, final.leagueId);
    const kept = await findLeague(db, final.userId, final.leagueId);
    expect(kept!.name).toBe("Renamed on ESPN");
    expect(kept!.settings).toEqual({ ...before, scoring: "half" });
  });

  it("reads ESPN again once the cached copy is older than the caller allows", async () => {
    const { userId, leagueId } = await connectedLeague();
    const { load, fetchImpl, advance } = setup();
    await load(db, KEY, userId, leagueId);
    advance(400);
    await load(db, KEY, userId, leagueId, { maxAgeMs: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(200);
    await load(db, KEY, userId, leagueId, { maxAgeMs: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reads a past week on its own, cached apart from the current week (APE-251)", async () => {
    const { userId, leagueId } = await connectedLeague();
    const { load, fetchImpl } = setup();
    await load(db, KEY, userId, leagueId);
    await load(db, KEY, userId, leagueId, { week: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("scoringPeriodId");
    expect(String(fetchImpl.mock.calls[1][0])).toContain("&scoringPeriodId=3");
    await load(db, KEY, userId, leagueId, { week: 3 });
    await load(db, KEY, userId, leagueId);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("marks the login disconnected when ESPN refuses it", async () => {
    const { userId, leagueId } = await connectedLeague();
    const { load } = setup(() => new Response("{}", { status: 401 }));
    expect(await load(db, KEY, userId, leagueId)).toEqual({ kind: "disconnected" });
    expect((await loginStatus(db, userId))?.status).toBe("disconnected");
    expect(await load(db, KEY, userId, leagueId)).toEqual({ kind: "disconnected" });
  });

  it("keeps the login when ESPN's refusal doesn't hold up on a second read", async () => {
    const { userId, leagueId } = await connectedLeague();
    let refusals = 1;
    const { load, fetchImpl } = setup(() => (refusals-- > 0 ? new Response("{}", { status: 403 }) : new Response(JSON.stringify(league))));
    expect(await load(db, KEY, userId, leagueId)).toEqual({ kind: "unavailable" });
    expect(String(fetchImpl.mock.calls[1][0])).toContain("/leagues/110222051?view=mSettings");
    expect((await loginStatus(db, userId))?.status).toBe("connected");
    expect(await load(db, KEY, userId, leagueId)).toMatchObject({ kind: "ok", stale: false });
  });

  it("serves the last good read, marked stale, when ESPN is down", async () => {
    const { userId, leagueId } = await connectedLeague();
    let down = false;
    const { load, advance } = setup(() => (down ? new Response("", { status: 503 }) : new Response(JSON.stringify(league))));
    await load(db, KEY, userId, leagueId);
    advance(2000);
    down = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await load(db, KEY, userId, leagueId)).toMatchObject({ kind: "ok", stale: true });
    warn.mockRestore();
  });

  it("says what's missing: no link, no login, or ESPN down with nothing cached", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    const { load } = setup(() => new Response("", { status: 503 }));
    expect(await load(db, KEY, userId, leagueId)).toEqual({ kind: "not-linked" });
    await linkSeason(db, userId, { leagueId, espnLeagueId: "110222051", espnTeamId: 1, season: 2026 });
    expect(await load(db, KEY, userId, leagueId)).toEqual({ kind: "no-login" });
    await storeLogin(db, KEY, userId, LOGIN, { season: 2026, consentVersion: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await load(db, KEY, userId, leagueId)).toEqual({ kind: "unavailable" });
    warn.mockRestore();
  });
});
