import type { PlanView } from "@/lib/ai/planView";
import type { DraftState, LeagueSettings, UiPrefs } from "@/lib/draft/types";

/**
 * Persistence interfaces. UI code talks only to these (via getStores()), never to
 * localStorage or fetch directly, so the local and server-backed implementations are interchangeable.
 * Every method is async for that reason, even though localStorage is synchronous.
 */

/** A saved league: the engine's settings plus the metadata needed to keep several of them. */
export interface LeagueRecord {
  id: string;
  name: string;
  season: number;
  /** Fingerprint of the player data the league's picks were logged against (see datasetId()). */
  datasetId: string;
  settings: LeagueSettings;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

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
  /** Every saved league, oldest first. */
  listLeagues(): Promise<LeagueRecord[]>;
  getLeague(id: string): Promise<LeagueRecord | null>;
  /** Creates or replaces the league with this id. */
  saveLeague(league: LeagueRecord): Promise<void>;
  /** Deletes the league and its draft. */
  deleteLeague(id: string): Promise<void>;
}

/** Leagues saved on this device while signed out, which a signed-in user can copy into their account. */
export interface ImportStore {
  /** Local leagues the account doesn't have and the user hasn't declined. */
  pending(): Promise<LeagueRecord[]>;
  /** Copies these local leagues (and their drafts) into the account. */
  importLeagues(ids: string[]): Promise<void>;
  /** Stops offering these leagues. */
  dismiss(ids: string[]): Promise<void>;
}

/** Background sync state, present only on server-backed stores. */
export interface SyncControl {
  /** Tries to push every unsynced change now. Resolves true when nothing is left unsynced. */
  flush(): Promise<boolean>;
}

export type AiPlanResult =
  | { ok: true; view: PlanView }
  | {
      ok: false;
      /** offline: unreachable, or league edits couldn't sync first. unavailable: not allowed on this account. */
      reason: "offline" | "signed-out" | "unavailable" | "not-found" | "invalid-league";
      /** The server's explanation, when it gave one. */
      message?: string;
    };

/** The league's AI-written game plan, written on the server in the background. */
export interface AiPlanStore {
  /** The plan and its job status. Also resumes a job a server restart interrupted. */
  get(leagueId: string): Promise<AiPlanResult>;
  /** Syncs league edits, then asks for a plan for the league's current settings. Idempotent. */
  request(leagueId: string): Promise<AiPlanResult>;
}

export interface Stores {
  draft: DraftStore;
  prefs: PrefsStore;
  league: LeagueStore;
  /** Present when signed in. */
  imports?: ImportStore;
  /** Present when signed in. */
  sync?: SyncControl;
  /** Present when signed in. Whether AI plans are enabled is a separate flag (PublicFlags.aiEnabled). */
  aiPlan?: AiPlanStore;
}
