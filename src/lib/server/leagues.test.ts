import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { standardRoster } from "@/lib/data";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { DraftState } from "@/lib/draft/types";
import type { LeagueRecord } from "@/lib/storage/types";
import { deleteLeague, getDraft, listLeagues, MAX_LEAGUES_PER_USER, putDraft, upsertLeague } from "./leagues";

let db: Db;
let close: () => Promise<void>;
let alice: string;
let bob: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  alice = await createTestUser(db);
  bob = await createTestUser(db);
});

let seq = 0;
const record = (patch: Partial<LeagueRecord> = {}): LeagueRecord => ({
  id: `league-${++seq}`,
  name: "Home league",
  season: 2026,
  datasetId: "2026-abc",
  settings: { teams: 12, mySlot: 3, scoring: "ppr", valueThreshold: 10, roster: standardRoster() },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...patch,
});
const draft = (...ids: string[]): DraftState => ({ version: 1, picks: ids.map((playerId) => ({ playerId, mine: false })) });

describe("leagues", () => {
  it("creates, lists (oldest first) and updates a user's leagues", async () => {
    const a = record({ createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" });
    const b = record({ name: "Work league" });
    expect(await upsertLeague(db, alice, a)).toMatchObject({ status: "ok", applied: true, league: a });
    await upsertLeague(db, alice, b);
    expect((await listLeagues(db, alice)).map((l) => l.id)).toEqual([b.id, a.id]);

    const renamed = { ...a, name: "Renamed", updatedAt: "2026-09-03T00:00:00.000Z" };
    expect(await upsertLeague(db, alice, renamed)).toMatchObject({ status: "ok", applied: true, league: renamed });
    expect(await listLeagues(db, bob)).toEqual([]);
  });

  it("keeps the newer edit when an older one arrives late", async () => {
    const newer = record({ name: "Newer", updatedAt: "2026-09-05T00:00:00.000Z" });
    await upsertLeague(db, alice, newer);
    const result = await upsertLeague(db, alice, { ...newer, name: "Older", updatedAt: "2026-09-04T00:00:00.000Z" });
    expect(result).toMatchObject({ status: "ok", applied: false, league: { name: "Newer" } });
  });

  it("round-trips timestamps exactly", async () => {
    const a = record({ createdAt: "2026-09-01T12:34:56.789Z", updatedAt: "2026-09-01T12:34:56.789Z" });
    await upsertLeague(db, alice, a);
    expect((await listLeagues(db, alice))[0]).toEqual(a);
  });

  it("caps leagues per user", async () => {
    const heavy = await createTestUser(db);
    for (let i = 0; i < MAX_LEAGUES_PER_USER; i++) await upsertLeague(db, heavy, record());
    expect(await upsertLeague(db, heavy, record())).toEqual({ status: "limit" });
    // Updating an existing league is still allowed at the cap.
    const [first] = await listLeagues(db, heavy);
    expect(await upsertLeague(db, heavy, { ...first, name: "Still editable", updatedAt: "2026-09-09T00:00:00.000Z" })).toMatchObject({ status: "ok" });
  });

  it("soft-deletes: the league disappears and can't be written or revived", async () => {
    const a = record();
    await upsertLeague(db, alice, a);
    expect(await deleteLeague(db, alice, a.id)).toBe(true);
    expect(await listLeagues(db, alice)).toEqual([]);
    expect(await deleteLeague(db, alice, a.id)).toBe(false);
    expect(await upsertLeague(db, alice, { ...a, updatedAt: "2026-09-09T00:00:00.000Z" })).toEqual({ status: "not-found" });
    expect(await getDraft(db, alice, a.id)).toBeNull();
    expect(await putDraft(db, alice, a.id, draft("x"), 0)).toEqual({ status: "not-found" });
  });
});

describe("authorization: another user's league looks like no league", () => {
  let league: LeagueRecord;
  beforeEach(async () => {
    league = record({ name: "Alice's" });
    await upsertLeague(db, alice, league);
    await putDraft(db, alice, league.id, draft("p1"), 0);
  });

  it("can't be listed or read", async () => {
    expect(await listLeagues(db, bob)).toEqual([]);
    expect(await getDraft(db, bob, league.id)).toBeNull();
  });

  it("can't be overwritten, even with a newer edit", async () => {
    expect(await upsertLeague(db, bob, { ...league, name: "Stolen", updatedAt: "2030-01-01T00:00:00.000Z" })).toEqual({ status: "not-found" });
    expect((await listLeagues(db, alice))[0].name).toBe("Alice's");
  });

  it("can't have its draft written", async () => {
    expect(await putDraft(db, bob, league.id, draft("evil"), 1)).toEqual({ status: "not-found" });
    expect(await putDraft(db, bob, league.id, draft("evil"), 0)).toEqual({ status: "not-found" });
    expect((await getDraft(db, alice, league.id))?.state?.picks.map((p) => p.playerId)).toEqual(["p1"]);
  });

  it("can't be deleted", async () => {
    expect(await deleteLeague(db, bob, league.id)).toBe(false);
    expect(await listLeagues(db, alice)).toHaveLength(1);
  });
});

describe("drafts", () => {
  let league: LeagueRecord;
  beforeEach(async () => {
    league = record();
    await upsertLeague(db, alice, league);
  });

  it("starts empty at revision 0 and counts up on each save", async () => {
    expect(await getDraft(db, alice, league.id)).toEqual({ state: null, revision: 0 });
    expect(await putDraft(db, alice, league.id, draft("a"), 0)).toEqual({ status: "ok", revision: 1 });
    expect(await putDraft(db, alice, league.id, draft("a", "b"), 1)).toEqual({ status: "ok", revision: 2 });
    expect(await getDraft(db, alice, league.id)).toEqual({ state: draft("a", "b"), revision: 2 });
  });

  it("rejects a save based on a stale revision and returns what's stored", async () => {
    await putDraft(db, alice, league.id, draft("a"), 0);
    await putDraft(db, alice, league.id, draft("a", "device1"), 1);
    const stale = await putDraft(db, alice, league.id, draft("a", "device2"), 1);
    expect(stale).toEqual({ status: "conflict", current: { state: draft("a", "device1"), revision: 2 } });
    // A second "first save" is stale too.
    expect(await putDraft(db, alice, league.id, draft("z"), 0)).toMatchObject({ status: "conflict" });
  });

  it("lets exactly one of two concurrent saves win", async () => {
    await putDraft(db, alice, league.id, draft("a"), 0);
    const results = await Promise.all([putDraft(db, alice, league.id, draft("a", "x"), 1), putDraft(db, alice, league.id, draft("a", "y"), 1)]);
    expect(results.map((r) => r.status).sort()).toEqual(["conflict", "ok"]);
  });

  it("is available from a second device (another session for the same user)", async () => {
    await putDraft(db, alice, league.id, draft("a", "b", "c"), 0);
    // Nothing in the data layer is tied to a device: the same user id sees the same league and draft.
    expect((await listLeagues(db, alice)).map((l) => l.id)).toContain(league.id);
    expect((await getDraft(db, alice, league.id))?.state?.picks).toHaveLength(3);
  });
});
