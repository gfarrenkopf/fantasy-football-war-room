import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { totalPicks } from "@/lib/draft/snake";
import { ESPN_SEASON_VERSION } from "@/lib/espn/disclosure";
import type { Crosswalk } from "@/lib/espn/crosswalk";
import type { LiveSnapshot } from "@/lib/espn/live";
import { toSeasonSettings } from "@/lib/espn/league";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import { connectEspn, findLeague, getDraft, putDraft } from "../leagues";
import { createTestLeague } from "../testLeagues";
import { storeLogin } from "./logins";
import { linkSeason } from "./seasonLinks";

vi.mock("server-only", () => ({}));
const { finalizeCompletedDraft, finalizeFromLive, importEspnDraft, reconcileEspnDraft } = await import("./draftImport");
const { connectSeason } = await import("./seasonConnect");

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const KEY = randomBytes(32);
const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";
/** Every ESPN id is off the board except 1000, who is Bijan. */
const crosswalkFor = async (): Promise<Crosswalk> => (id) =>
  id === 1000 ? { kind: "matched", playerId: "bijan-robinson-rb" } : { kind: "offBoard", player: { name: `Player ${id}`, pos: "WR", team: "DET" } };

/** A finished ESPN snake draft of `n` picks, teams 1..teams in order, the first pick Bijan. */
function finished(n: number, teams = 12) {
  const picks = Array.from({ length: n }, (_, i) => ({ overallPickNumber: i + 1, teamId: (i % teams) + 1, playerId: 1000 + i }));
  return { draftDetail: { drafted: true, inProgress: false, picks } };
}

const TOTAL = 12 * 16; // createTestLeague: 12 teams, standard 16-slot roster

const FINAL = { source: "espn", at: expect.any(String) };

describe("importEspnDraft", () => {
  it("makes ESPN's finished draft the board, the user's picks marked, and locks it", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    const settings = (await findLeague(db, userId, leagueId))!.settings;
    expect(totalPicks(settings)).toBe(TOTAL);

    expect(await importEspnDraft(db, userId, leagueId, finished(TOTAL), { espnTeamId: 1, season: 2026 }, { crosswalkFor })).toEqual({ kind: "imported" });
    const { state, revision } = (await getDraft(db, userId, leagueId))!;
    expect(revision).toBe(1);
    expect(state!.final).toEqual(FINAL);
    expect(state!.picks).toHaveLength(TOTAL);
    expect(state!.picks[0]).toEqual({ playerId: "bijan-robinson-rb", mine: true });
    expect(state!.picks[1]).toMatchObject({ playerId: "espn:1001", mine: false });
  });

  it("replaces picks logged by hand (APE-325), and leaves a final board alone", async () => {
    const userId = await createTestUser(db);
    const logged = await createTestLeague(db, userId);
    await putDraft(db, userId, logged, { version: 1, picks: [{ playerId: "ja-marr-chase-wr", mine: true }] }, 0);
    expect(await importEspnDraft(db, userId, logged, finished(TOTAL), { espnTeamId: 1, season: 2026 }, { crosswalkFor })).toEqual({ kind: "imported" });
    expect((await getDraft(db, userId, logged))!.state!.picks).toHaveLength(TOTAL);
    expect(await importEspnDraft(db, userId, logged, finished(TOTAL), { espnTeamId: 2, season: 2026 }, { crosswalkFor })).toEqual({ kind: "already-final" });
    expect((await getDraft(db, userId, logged))!.state!.picks[0].mine).toBe(true);
  });

  it("leaves a draft that doesn't fit, or isn't over, alone, and says why", async () => {
    const userId = await createTestUser(db);
    const other = await createTestLeague(db, userId);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await importEspnDraft(db, userId, other, finished(40, 4), { espnTeamId: 1, season: 2026 }, { crosswalkFor })).toEqual({
      kind: "mismatch",
      reason: `ESPN's draft has 40 picks; this league's board has ${TOTAL}`,
    });
    expect(await importEspnDraft(db, userId, other, { draftDetail: { drafted: false, picks: [] } }, { espnTeamId: 1, season: 2026 }, { crosswalkFor })).toEqual({ kind: "not-finished" });
    expect((await getDraft(db, userId, other))!.state).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("reconcileEspnDraft", () => {
  it("reads the draft with the stored login for a connected league that isn't final, and only then", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    await connectEspn(db, userId, leagueId, { espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });
    await putDraft(db, userId, leagueId, { version: 1, picks: [{ playerId: "ja-marr-chase-wr", mine: true }] }, 0);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(finished(TOTAL))));

    expect(await reconcileEspnDraft(db, KEY, userId, leagueId, { fetchImpl, crosswalkFor })).toEqual({ kind: "no-login" });
    await storeLogin(db, KEY, userId, { espnS2: "s2", swid: SWID }, { season: 2026, consentVersion: ESPN_SEASON_VERSION });
    expect(await reconcileEspnDraft(db, KEY, userId, leagueId, { fetchImpl, crosswalkFor })).toEqual({ kind: "imported" });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/leagues/704343562?view=mDraftDetail");
    expect(await reconcileEspnDraft(db, KEY, userId, leagueId, { fetchImpl, crosswalkFor })).toEqual({ kind: "already-final" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no ESPN read once the board is final
  });

  it("uses the season link for a league linked before the connection marker", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    await storeLogin(db, KEY, userId, { espnS2: "s2", swid: SWID }, { season: 2026, consentVersion: ESPN_SEASON_VERSION });
    await linkSeason(db, userId, { leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(finished(TOTAL))));
    expect(await reconcileEspnDraft(db, KEY, userId, leagueId, { fetchImpl, crosswalkFor })).toEqual({ kind: "imported" });
  });

  it("does nothing for a league that isn't connected", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    expect(await reconcileEspnDraft(db, KEY, userId, leagueId, { crosswalkFor })).toEqual({ kind: "no-league" });
  });
});

describe("finalizeFromLive", () => {
  const livePick = (i: number) => ({ n: i + 1, teamId: (i % 12) + 1, mine: i % 12 === 0, auto: false, espnPlayerId: 1000 + i, playerId: i === 0 ? "bijan-robinson-rb" : null, offBoard: null });
  const live = (n: number, patch: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
    status: "complete",
    draft: "complete",
    anchored: true,
    espnTeamId: 1,
    picks: Array.from({ length: n }, (_, i) => livePick(i)),
    onClock: null,
    sessions: 1,
    request: null,
    espnLeague: null,
    degraded: null,
    autopick: false,
    serverClient: null,
    ...patch,
  });

  it("locks the feed's draft when it saw all of it", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    expect(await finalizeFromLive(db, userId, leagueId, live(TOTAL))).toEqual({ kind: "imported" });
    const state = (await getDraft(db, userId, leagueId))!.state!;
    expect(state.final).toEqual(FINAL);
    expect(state.picks[0]).toEqual({ playerId: "bijan-robinson-rb", mine: true });
    expect(state.picks[1]).toMatchObject({ playerId: "espn:1001", mine: false });
  });

  it("won't vouch for a feed that joined late, drifted, isn't done, or is short", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    expect(await finalizeFromLive(db, userId, leagueId, live(TOTAL, { anchored: false }))).toEqual({ kind: "not-finished" });
    expect(await finalizeFromLive(db, userId, leagueId, live(TOTAL, { degraded: { reason: "x", unknownFrames: 20, malformedFrames: 0 } }))).toEqual({ kind: "not-finished" });
    expect(await finalizeFromLive(db, userId, leagueId, live(TOTAL, { draft: "live" }))).toEqual({ kind: "not-finished" });
    expect(await finalizeFromLive(db, userId, leagueId, live(TOTAL - 1))).toMatchObject({ kind: "mismatch" });
    expect((await getDraft(db, userId, leagueId))!.state).toBeNull();
  });

  it("prefers ESPN's own record when there's a login, and falls back to the feed when ESPN isn't ready", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    await connectEspn(db, userId, leagueId, { espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });
    await storeLogin(db, KEY, userId, { espnS2: "s2", swid: SWID }, { season: 2026, consentVersion: ESPN_SEASON_VERSION });
    const notYet = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ draftDetail: { drafted: false, inProgress: true, picks: [] } })));
    expect(await finalizeCompletedDraft(db, KEY, userId, leagueId, live(TOTAL), { fetchImpl: notYet, crosswalkFor })).toEqual({ kind: "imported" });
    expect(notYet).toHaveBeenCalledTimes(1);
    expect((await getDraft(db, userId, leagueId))!.state!.final).toEqual(FINAL);
  });
});

describe("connectSeason", () => {
  it("brings a finished ESPN draft onto the new league's board", async () => {
    const userId = await createTestUser(db);
    const imported = toSeasonSettings(league.settings, 3);
    if (!imported.ok) throw new Error(imported.error);
    const total = totalPicks(imported.league);
    const body = { settings: league.settings, teams: [{ id: 3, owners: [SWID] }], ...finished(total, imported.league.teams) };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    const request = { espnLeagueId: "110222051", season: 2026, consentVersion: ESPN_SEASON_VERSION, espnS2: "s2", swid: SWID };

    const result = await connectSeason(db, KEY, userId, request, { fetchImpl, crosswalkFor });
    expect(result).toMatchObject({ ok: true, created: true });
    if (!result.ok) return;
    expect(String(fetchImpl.mock.calls[0][0])).toContain("view=mDraftDetail");
    expect((await getDraft(db, userId, result.leagueId))!.state!.picks).toHaveLength(total);
    expect((await getDraft(db, userId, result.leagueId))!.state!.final).toEqual(FINAL);
  });
});
