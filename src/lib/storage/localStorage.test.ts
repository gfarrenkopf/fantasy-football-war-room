import { describe, expect, it } from "vitest";
import type { DraftState, LeagueSettings, UiPrefs } from "@/lib/draft/types";
import { createLocalStores, migrateDraftState, storageKeys } from "./localStorage";

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
    expect(storage.data.has(storageKeys.draft("local"))).toBe(true);
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
    storage.setItem(storageKeys.draft("local"), "{not json");
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

describe("prefs and league stores", () => {
  it("round-trip", async () => {
    const stores = createLocalStores(memoryStorage());
    const prefs: UiPrefs = { view: "board", center: "plan", baMode: "all", mockOn: true, room: ["casual", "sharp"] };
    const league: LeagueSettings = { teams: 10, mySlot: 7, scoring: "ppr", valueThreshold: 10, roster: [{ key: "QB", eligible: ["QB"] }] };
    await stores.prefs.savePrefs(prefs);
    await stores.league.saveLeague(league);
    expect(await stores.prefs.getPrefs()).toEqual(prefs);
    expect(await stores.league.getLeague()).toEqual(league);
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
