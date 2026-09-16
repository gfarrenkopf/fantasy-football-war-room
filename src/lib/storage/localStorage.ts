import type { DraftState, UiPrefs } from "@/lib/draft/types";
import { newId, nowIso } from "./ids";
import { migrateDraftState, parseLeagueRecord } from "./records";
import type { LeagueRecord, Stores } from "./types";

export { migrateDraftState } from "./records";

/** Keys from before leagues had ids: one league and one draft per browser. Read only by the migration. */
export const legacyKeys = {
  league: "fwr:v1:league",
  draft: "fwr:v1:draft:local",
};

/** Keys under which a set of stores keeps its data. A namespace keeps one account's cache apart from signed-out data. */
export function storageKeys(namespace?: string) {
  const prefix = namespace ? `fwr:v2:u:${namespace}` : "fwr:v2";
  return {
    prefix,
    leagues: `${prefix}:leagues`,
    draft: (leagueId: string) => `${prefix}:draft:${leagueId}`,
    /** Device-wide, never namespaced. */
    prefs: "fwr:v1:prefs",
  };
}

/** The browser's localStorage, or null when unavailable (SSR, private mode, blocked site data). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readJson(storage: Storage | null, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJson(storage: Storage | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked: the app keeps working in memory.
  }
}

export function removeKey(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
}

/** What the one-time migration needs to know about the data the legacy league was drafted against. */
export interface LegacyContext {
  season: number;
  datasetId: string;
}

export interface LocalStoreOptions {
  /** Keeps these stores' leagues and drafts separate (an account's cache). Prefs are always shared. */
  namespace?: string;
  /** When given, a pre-multi-league league and draft are moved into the first league record. */
  legacy?: LegacyContext;
}

/**
 * Moves the single league and draft saved before leagues had ids into a league record.
 * Runs once: it does nothing when there's no legacy league or leagues have already been saved.
 */
export function migrateLegacyLeague(storage: Storage | null, legacy: LegacyContext): void {
  const keys = storageKeys();
  if (readJson(storage, keys.leagues) !== null) return;
  const settings = readJson(storage, legacyKeys.league);
  if (settings === null) return;
  const now = nowIso();
  const record = parseLeagueRecord({ id: newId(), name: "My league", season: legacy.season, datasetId: legacy.datasetId, settings, createdAt: now, updatedAt: now });
  if (record) {
    const draft = migrateDraftState(readJson(storage, legacyKeys.draft));
    if (draft) writeJson(storage, keys.draft(record.id), draft);
    writeJson(storage, keys.leagues, [record]);
  }
  // A malformed legacy league is dropped, as the app already ignored it.
  removeKey(storage, legacyKeys.league);
  removeKey(storage, legacyKeys.draft);
}

/** Stores backed by localStorage. Pass a Storage to use something else (tests use an in-memory fake). */
export function createLocalStores(storage: Storage | null = browserStorage(), options: LocalStoreOptions = {}): Stores {
  const keys = storageKeys(options.namespace);
  if (options.legacy && !options.namespace) migrateLegacyLeague(storage, options.legacy);

  const getDraft = (id: string) => migrateDraftState(readJson(storage, keys.draft(id)));
  const readLeagues = (): LeagueRecord[] => {
    const raw = readJson(storage, keys.leagues);
    if (!Array.isArray(raw)) return [];
    return raw.map(parseLeagueRecord).filter((r): r is LeagueRecord => r !== null);
  };

  return {
    draft: {
      async getDraftState(draftKey) {
        return getDraft(draftKey);
      },
      async saveDraftState(draftKey, state: DraftState) {
        writeJson(storage, keys.draft(draftKey), state);
      },
      async deletePick(draftKey, index) {
        const state = getDraft(draftKey);
        if (!state) return null;
        const next = { ...state, picks: state.picks.filter((_, i) => i !== index) };
        writeJson(storage, keys.draft(draftKey), next);
        return next;
      },
      async resetDraft(draftKey) {
        removeKey(storage, keys.draft(draftKey));
      },
    },
    prefs: {
      async getPrefs() {
        return (readJson(storage, keys.prefs) as UiPrefs | null) ?? null;
      },
      async savePrefs(prefs) {
        writeJson(storage, keys.prefs, prefs);
      },
    },
    league: {
      async listLeagues() {
        return readLeagues();
      },
      async getLeague(id) {
        return readLeagues().find((l) => l.id === id) ?? null;
      },
      async saveLeague(league) {
        const leagues = readLeagues();
        const i = leagues.findIndex((l) => l.id === league.id);
        if (i === -1) leagues.push(league);
        else leagues[i] = league;
        writeJson(storage, keys.leagues, leagues);
      },
      async deleteLeague(id) {
        writeJson(
          storage,
          keys.leagues,
          readLeagues().filter((l) => l.id !== id),
        );
        removeKey(storage, keys.draft(id));
      },
    },
  };
}

/** Removes every key a namespace owns (an account's cached leagues, drafts and sync state). */
export function clearNamespace(storage: Storage | null, namespace: string): void {
  const prefix = `${storageKeys(namespace).prefix}:`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < (storage?.length ?? 0); i++) {
      const key = storage?.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => removeKey(storage, key));
  } catch {
    // ignore
  }
}
