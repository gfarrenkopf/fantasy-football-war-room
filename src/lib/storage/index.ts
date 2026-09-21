import { dataset, DATASET_ID } from "@/lib/data";
import { browserStorage, clearNamespace, createLocalStores, readJson, removeKey, writeJson } from "./localStorage";
import { createServerStores, hasUnsyncedChanges, type SyncIssue } from "./server";
import type { Stores } from "./types";

export type { AiPlanResult, AiPlanStore, CheckoutResult, CheckoutStore, DraftStore, ImportStore, LeagueRecord, LeagueStore, PrefsStore, Purchase, Stores, SyncControl } from "./types";
export type { SyncIssue } from "./server";
export { newId, nowIso } from "./ids";
export { newLeagueRecord } from "./newLeague";
export { MAX_LEAGUE_NAME } from "./records";

/** The account whose data this device has cached, so it can be cleared once that user signs out. */
const LAST_USER_KEY = "fwr:v2:last-user";

const legacy = { season: dataset.season, datasetId: DATASET_ID };

let stores: Stores | null = null;
let configuredFor: string | null = null;

const issueListeners = new Set<(issue: SyncIssue) => void>();

/** Subscribes to background sync problems (offline, conflicts). Returns an unsubscribe function. */
export function subscribeSyncIssues(listener: (issue: SyncIssue) => void): () => void {
  issueListeners.add(listener);
  return () => issueListeners.delete(listener);
}

/**
 * The single place that chooses a persistence implementation: server-backed when signed in
 * with cloud features on, localStorage otherwise. Call before anything reads getStores() for
 * the session; calling again with the same session is a no-op.
 */
export function configureStores({ cloudEnabled, userId }: { cloudEnabled: boolean; userId: string | null }): void {
  if (typeof window === "undefined") return; // stores are browser-only; server renders never read them
  const key = cloudEnabled && userId ? `user:${userId}` : "local";
  if (configuredFor === key) return;
  configuredFor = key;

  const storage = browserStorage();
  const lastUser = readJson(storage, LAST_USER_KEY);
  // A different account (or none) is active now: drop the previous account's cached copy, unless
  // it still holds changes that never synced (e.g. the session expired), which stay until that user returns.
  if (typeof lastUser === "string" && lastUser !== userId && !hasUnsyncedChanges(storage, lastUser)) {
    clearNamespace(storage, lastUser);
    removeKey(storage, LAST_USER_KEY);
  }

  if (cloudEnabled && userId) {
    writeJson(storage, LAST_USER_KEY, userId);
    stores = createServerStores({ userId, storage, legacy, onSyncIssue: (issue) => issueListeners.forEach((l) => l(issue)) });
  } else {
    stores = createLocalStores(storage, { legacy });
  }
}

export function getStores(): Stores {
  stores ??= createLocalStores(undefined, { legacy });
  return stores;
}
