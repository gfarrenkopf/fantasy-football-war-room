import type { DraftState, LeagueSettings, UiPrefs } from "@/lib/draft/types";

/**
 * Persistence interfaces. UI code talks only to these (via getStores()), never to
 * localStorage directly, so Epic 3 can swap in a server-backed implementation.
 * Every method is async for that reason, even though localStorage is synchronous.
 */

export interface DraftStore {
  /** The saved draft, or null if none exists or it can't be read. */
  getDraftState(draftKey: string): Promise<DraftState | null>;
  saveDraftState(draftKey: string, state: DraftState): Promise<void>;
  /** Removes the pick at `index` (0-based) and returns the updated state, or null if there is no draft. */
  deletePick(draftKey: string, index: number): Promise<DraftState | null>;
  resetDraft(draftKey: string): Promise<void>;
}

export interface PrefsStore {
  getPrefs(): Promise<UiPrefs | null>;
  savePrefs(prefs: UiPrefs): Promise<void>;
}

export interface LeagueStore {
  getLeague(): Promise<LeagueSettings | null>;
  saveLeague(league: LeagueSettings): Promise<void>;
}

export interface Stores {
  draft: DraftStore;
  prefs: PrefsStore;
  league: LeagueStore;
}

/** Key of the single local draft. Server-backed stores will use real league/draft ids. */
export const LOCAL_DRAFT_KEY = "local";
