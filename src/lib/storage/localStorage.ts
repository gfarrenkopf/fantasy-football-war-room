import { DRAFT_STATE_VERSION } from "@/lib/draft/state";
import type { DraftPick, DraftState, LeagueSettings, UiPrefs } from "@/lib/draft/types";
import type { Stores } from "./types";

const PREFIX = "fwr:v1";
export const storageKeys = {
  draft: (draftKey: string) => `${PREFIX}:draft:${draftKey}`,
  prefs: `${PREFIX}:prefs`,
  league: `${PREFIX}:league`,
};

/** The browser's localStorage, or null when unavailable (SSR, private mode, blocked site data). */
function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage | null, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked: the app keeps working in memory.
  }
}

function remove(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
}

const isPick = (p: unknown): p is DraftPick =>
  typeof p === "object" && p !== null && typeof (p as DraftPick).playerId === "string" && typeof (p as DraftPick).mine === "boolean";

/**
 * Validates and upgrades a stored draft. Add a case here when DRAFT_STATE_VERSION changes.
 * Anything unrecognizable is discarded rather than crashing the app.
 */
export function migrateDraftState(raw: unknown): DraftState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { version, picks } = raw as Partial<DraftState>;
  if (version !== DRAFT_STATE_VERSION || !Array.isArray(picks) || !picks.every(isPick)) return null;
  return { version, picks: picks.map(({ playerId, mine }) => ({ playerId, mine })) };
}

/** Stores backed by localStorage. Pass a Storage to use something else (tests use an in-memory fake). */
export function createLocalStores(storage: Storage | null = browserStorage()): Stores {
  const getDraft = (draftKey: string) => migrateDraftState(read(storage, storageKeys.draft(draftKey)));

  return {
    draft: {
      async getDraftState(draftKey) {
        return getDraft(draftKey);
      },
      async saveDraftState(draftKey, state) {
        write(storage, storageKeys.draft(draftKey), state);
      },
      async deletePick(draftKey, index) {
        const state = getDraft(draftKey);
        if (!state) return null;
        const next = { ...state, picks: state.picks.filter((_, i) => i !== index) };
        write(storage, storageKeys.draft(draftKey), next);
        return next;
      },
      async resetDraft(draftKey) {
        remove(storage, storageKeys.draft(draftKey));
      },
    },
    prefs: {
      async getPrefs() {
        return (read(storage, storageKeys.prefs) as UiPrefs | null) ?? null;
      },
      async savePrefs(prefs) {
        write(storage, storageKeys.prefs, prefs);
      },
    },
    league: {
      async getLeague() {
        return (read(storage, storageKeys.league) as LeagueSettings | null) ?? null;
      },
      async saveLeague(league) {
        write(storage, storageKeys.league, league);
      },
    },
  };
}
