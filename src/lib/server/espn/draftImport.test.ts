import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { totalPicks } from "@/lib/draft/snake";
import { ESPN_SEASON_VERSION } from "@/lib/espn/disclosure";
import type { Crosswalk } from "@/lib/espn/crosswalk";
import { toSeasonSettings } from "@/lib/espn/league";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import { findLeague, getDraft, putDraft } from "../leagues";
import { createTestLeague } from "../testLeagues";
import { storeLogin } from "./logins";
import { linkSeason } from "./seasonLinks";

vi.mock("server-only", () => ({}));
const { backfillEspnDraft, importEspnDraft } = await import("./draftImport");
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

describe("importEspnDraft", () => {
  it("fills an empty board with ESPN's finished draft, the user's picks marked", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    const settings = (await findLeague(db, userId, leagueId))!.settings;
    expect(totalPicks(settings)).toBe(TOTAL);

    expect(await importEspnDraft(db, userId, leagueId, finished(TOTAL), { espnTeamId: 1, season: 2026 }, { crosswalkFor })).toBe("imported");
    const { state, revision } = (await getDraft(db, userId, leagueId))!;
    expect(revision).toBe(1);
    expect(state!.picks).toHaveLength(TOTAL);
    expect(state!.picks[0]).toEqual({ playerId: "bijan-robinson-rb", mine: true });
    expect(state!.picks[1]).toMatchObject({ playerId: "espn:1001", mine: false });
  });

  it("never replaces picks already on the board, and leaves a draft that doesn't fit alone", async () => {
    const userId = await createTestUser(db);
    const logged = await createTestLeague(db, userId);
    await putDraft(db, userId, logged, { version: 1, picks: [{ playerId: "ja-marr-chase-wr", mine: true }] }, 0);
    expect(await importEspnDraft(db, userId, logged, finished(TOTAL), { espnTeamId: 1, season: 2026 }, { crosswalkFor })).toBe("has-picks");
    expect((await getDraft(db, userId, logged))!.state!.picks).toHaveLength(1);

    const other = await createTestLeague(db, userId);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await importEspnDraft(db, userId, other, finished(40, 4), { espnTeamId: 1, season: 2026 }, { crosswalkFor })).toBe("mismatch");
    expect(await importEspnDraft(db, userId, other, { draftDetail: { drafted: false, picks: [] } }, { espnTeamId: 1, season: 2026 }, { crosswalkFor })).toBe("not-finished");
    expect((await getDraft(db, userId, other))!.state).toBeNull();
    vi.restoreAllMocks();
  });

  it("fills an empty board saved earlier (an empty draft at revision 1)", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    await putDraft(db, userId, leagueId, { version: 1, picks: [] }, 0);
    expect(await importEspnDraft(db, userId, leagueId, finished(TOTAL), { espnTeamId: 2, season: 2026 }, { crosswalkFor })).toBe("imported");
    expect((await getDraft(db, userId, leagueId))!.revision).toBe(2);
  });
});

describe("backfillEspnDraft", () => {
  it("reads the draft with the stored login for a linked league with an empty board, and only then", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    await storeLogin(db, KEY, userId, { espnS2: "s2", swid: SWID }, { season: 2026, consentVersion: ESPN_SEASON_VERSION });
    await linkSeason(db, userId, { leagueId, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(finished(TOTAL))));

    expect(await backfillEspnDraft(db, KEY, userId, leagueId, { fetchImpl, crosswalkFor })).toBe("imported");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/leagues/704343562?view=mDraftDetail");
    expect(await backfillEspnDraft(db, KEY, userId, leagueId, { fetchImpl, crosswalkFor })).toBe("has-picks");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no ESPN read once the board has picks
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
  });
});
