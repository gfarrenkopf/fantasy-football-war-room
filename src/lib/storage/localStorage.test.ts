import { describe, expect, it } from "vitest";
import type { DraftState, LeagueSettings, UiPrefs } from "@/lib/draft/types";
import { createLocalStores, legacyKeys, migrateDraftState, storageKeys } from "./localStorage";
import type { LeagueRecord } from "./types";

/** Minimal in-memory Storage. */
function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const draft: DraftState = {
  version: 1,
  picks: [
    { playerId: "jahmyr-gibbs-rb-det", mine: true },
    { playerId: "bijan-robinson-rb-atl", mine: false },
  ],
};

describe("local draft store", () => {
  it("round-trips draft state", async () => {
    const storage = memoryStorage();
    const stores = createLocalStores(storage);
    expect(await stores.draft.getDraftState("local")).toBeNull();
    await stores.draft.saveDraftState("local", draft);
    // A fresh store over the same storage sees it, like a page refresh.
    expect(await createLocalStores(storage).draft.getDraftState("local")).toEqual(draft);
    expect(storage.data.has(storageKeys().draft("local"))).toBe(true);
  });

  it("keeps drafts under different keys separate", async () => {
    const stores = createLocalStores(memoryStorage());
    await stores.draft.saveDraftState("a", draft);
    expect(await stores.draft.getDraftState("b")).toBeNull();
  });

  it("deletePick removes one pick and persists it", async () => {
    const storage = memoryStorage();
    const stores = createLocalStores(storage);
    await stores.draft.saveDraftState("local", draft);
    expect((await stores.draft.deletePick("local", 0))?.picks).toEqual([draft.picks[1]]);
    expect((await stores.draft.getDraftState("local"))?.picks).toEqual([draft.picks[1]]);
    expect(await stores.draft.deletePick("missing", 0)).toBeNull();
  });

  it("resetDraft removes the saved draft", async () => {
    const stores = createLocalStores(memoryStorage());
    await stores.draft.saveDraftState("local", draft);
    await stores.draft.resetDraft("local");
    expect(await stores.draft.getDraftState("local")).toBeNull();
  });

  it("survives corrupt JSON and missing or throwing storage", async () => {
    const storage = memoryStorage();
    storage.setItem(storageKeys().draft("local"), "{not json");
    expect(await createLocalStores(storage).draft.getDraftState("local")).toBeNull();

    const none = createLocalStores(null);
    await none.draft.saveDraftState("local", draft);
    expect(await none.draft.getDraftState("local")).toBeNull();

    const throwing = { ...memoryStorage(), getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    const t = createLocalStores(throwing as Storage);
    await expect(t.draft.saveDraftState("local", draft)).resolves.toBeUndefined();
    expect(await t.draft.getDraftState("local")).toBeNull();
  });
});

const settings: LeagueSettings = { teams: 10, mySlot: 7, scoring: "ppr", valueThreshold: 10, roster: [{ key: "QB", eligible: ["QB"] }] };
const record = (id: string, name = id): LeagueRecord => ({
  id,
  name,
  season: 2026,
  datasetId: "2026-abc",
  settings,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});
const legacy = { season: 2026, datasetId: "2026-abc" };

describe("prefs store", () => {
  it("round-trips", async () => {
    const stores = createLocalStores(memoryStorage());
    const prefs: UiPrefs = { view: "board", center: "plan", baMode: "all", mockOn: true, room: ["casual", "sharp"], activeLeagueId: "a" };
    await stores.prefs.savePrefs(prefs);
    expect(await stores.prefs.getPrefs()).toEqual(prefs);
  });
});

describe("league store", () => {
  it("saves, lists, replaces and deletes leagues", async () => {
    const storage = memoryStorage();
    const stores = createLocalStores(storage);
    expect(await stores.league.listLeagues()).toEqual([]);
    await stores.league.saveLeague(record("a"));
    await stores.league.saveLeague(record("b"));
    await stores.league.saveLeague({ ...record("a"), name: "Renamed" });
    expect((await createLocalStores(storage).league.listLeagues()).map((l) => [l.id, l.name])).toEqual([
      ["a", "Renamed"],
      ["b", "b"],
    ]);
    expect(await stores.league.getLeague("b")).toEqual(record("b"));
    expect(await stores.league.getLeague("zzz")).toBeNull();

    await stores.draft.saveDraftState("a", draft);
    await stores.league.deleteLeague("a");
    expect((await stores.league.listLeagues()).map((l) => l.id)).toEqual(["b"]);
    expect(await stores.draft.getDraftState("a")).toBeNull();
  });

  it("keeps two leagues' drafts independent", async () => {
    const stores = createLocalStores(memoryStorage());
    await stores.league.saveLeague(record("a"));
    await stores.league.saveLeague(record("b"));
    await stores.draft.saveDraftState("a", draft);
    await stores.draft.saveDraftState("b", { version: 1, picks: [draft.picks[1]] });
    expect((await stores.draft.getDraftState("a"))?.picks).toHaveLength(2);
    expect((await stores.draft.getDraftState("b"))?.picks).toHaveLength(1);
  });

  it("drops malformed records instead of failing the whole list", async () => {
    const storage = memoryStorage();
    storage.setItem(storageKeys().leagues, JSON.stringify([record("ok"), { id: "bad" }, "junk"]));
    expect((await createLocalStores(storage).league.listLeagues()).map((l) => l.id)).toEqual(["ok"]);
  });

  it("keeps a namespace's leagues and drafts apart but shares prefs", async () => {
    const storage = memoryStorage();
    const anon = createLocalStores(storage);
    const account = createLocalStores(storage, { namespace: "user-1" });
    await anon.league.saveLeague(record("a"));
    await account.draft.saveDraftState("a", draft);
    expect(await account.league.listLeagues()).toEqual([]);
    expect(await anon.draft.getDraftState("a")).toBeNull();
    await anon.prefs.savePrefs({ view: "board", center: "ba", baMode: "pos", mockOn: false, room: null, activeLeagueId: null });
    expect((await account.prefs.getPrefs())?.view).toBe("board");
  });
});

describe("legacy single-league migration", () => {
  const legacyStorage = () => {
    const storage = memoryStorage();
    storage.setItem(legacyKeys.league, JSON.stringify(settings));
    storage.setItem(legacyKeys.draft, JSON.stringify(draft));
    return storage;
  };

  it("moves the old league and draft into a league record without losing picks", async () => {
    const storage = legacyStorage();
    const stores = createLocalStores(storage, { legacy });
    const [league, ...rest] = await stores.league.listLeagues();
    expect(rest).toEqual([]);
    expect(league).toMatchObject({ name: "My league", season: 2026, datasetId: "2026-abc", settings });
    expect(league.id).toMatch(/^[0-9a-f]{32}$/);
    expect(await stores.draft.getDraftState(league.id)).toEqual(draft);
    expect(storage.data.has(legacyKeys.league)).toBe(false);
    expect(storage.data.has(legacyKeys.draft)).toBe(false);
  });

  it("runs once", async () => {
    const storage = legacyStorage();
    const first = await createLocalStores(storage, { legacy }).league.listLeagues();
    // Even if old keys reappear (e.g. an old tab writes them), existing leagues are not overwritten.
    storage.setItem(legacyKeys.league, JSON.stringify(settings));
    expect(await createLocalStores(storage, { legacy }).league.listLeagues()).toEqual(first);
  });

  it("migrates a league with no draft, and ignores a malformed league", async () => {
    const noDraft = memoryStorage();
    noDraft.setItem(legacyKeys.league, JSON.stringify(settings));
    const [league] = await createLocalStores(noDraft, { legacy }).league.listLeagues();
    expect(await createLocalStores(noDraft).draft.getDraftState(league.id)).toBeNull();

    const bad = memoryStorage();
    bad.setItem(legacyKeys.league, JSON.stringify({ teams: "twelve" }));
    expect(await createLocalStores(bad, { legacy }).league.listLeagues()).toEqual([]);
  });

  it("leaves legacy data alone for namespaced stores", async () => {
    const storage = legacyStorage();
    createLocalStores(storage, { namespace: "user-1", legacy });
    expect(storage.data.has(legacyKeys.league)).toBe(true);
  });
});

describe("migrateDraftState", () => {
  it("accepts the current version and strips unknown fields", () => {
    const withExtra = { ...draft, picks: [{ playerId: "a", mine: true, junk: 1 }], extra: true };
    expect(migrateDraftState(withExtra)).toEqual({ version: 1, picks: [{ playerId: "a", mine: true }] });
  });

  it("rejects unknown versions and malformed picks", () => {
    expect(migrateDraftState({ version: 99, picks: [] })).toBeNull();
    expect(migrateDraftState({ version: 1, picks: [{ id: 3, mine: true }] })).toBeNull();
    expect(migrateDraftState("nope")).toBeNull();
    // The prototype's own format (numeric ids, no version) is not silently misread.
    expect(migrateDraftState({ picks: [{ id: 0, mine: true }], view: "focus" })).toBeNull();
  });
});
