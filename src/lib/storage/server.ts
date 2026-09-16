import { emptyDraftState } from "@/lib/draft/state";
import type { DraftState } from "@/lib/draft/types";
import { browserStorage, createLocalStores, readJson, storageKeys, writeJson, type LegacyContext } from "./localStorage";
import { migrateDraftState, parseLeagueRecord } from "./records";
import type { LeagueRecord, Stores } from "./types";

/**
 * Stores for a signed-in user: local-first, synced to the league API in the background.
 *
 * Every write lands in this device's cache (localStorage, namespaced by user) immediately and
 * resolves without waiting on the network, so logging a pick never stalls mid-draft. Changes
 * are marked dirty and pushed by a queue that runs one request per league at a time and always
 * sends the latest cached state, so a burst of picks collapses into a few requests. Dirty marks
 * are persisted, so changes made offline survive a reload and sync when the API is reachable.
 *
 * Conflicts: league edits keep the newest updatedAt (decided by the server). For drafts, this
 * device's latest state wins: a 409 means another device saved in between, so we adopt its
 * revision, overwrite, and report it. Real-time merging across devices is out of scope.
 */

export type SyncIssue =
  /** The API couldn't be reached; changes are saved on this device and will sync later. */
  | { kind: "offline" }
  /** The session expired; changes are saved on this device until the user signs in again. */
  | { kind: "signed-out" }
  /** Another device changed this draft since this device last synced; this device's picks replaced it. */
  | { kind: "conflict"; leagueId: string }
  /** The league no longer exists on the server (deleted on another device). */
  | { kind: "gone"; leagueId: string };

export interface ServerStoreOptions {
  userId: string;
  storage?: Storage | null;
  fetch?: typeof fetch;
  onSyncIssue?: (issue: SyncIssue) => void;
  /** Delays before retrying after a network failure, in ms; the last one repeats. */
  retryDelays?: number[];
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Passed to the signed-out stores that imports read from, so a not-yet-migrated legacy league is offered too. */
  legacy?: LegacyContext;
}

interface SyncMeta {
  /** Server revision each cached draft is based on, and whether it has unsynced changes. */
  drafts: Record<string, { revision: number; dirty: boolean }>;
  /** Leagues with unsynced creates or edits. */
  dirtyLeagues: string[];
  /** Leagues deleted on this device but not yet on the server. */
  deletedLeagues: string[];
}

const API = "/api/leagues";

const syncMetaKey = (userId: string) => `${storageKeys(userId).prefix}:sync`;

/** True when this device holds changes for the account that haven't reached the server. */
export function hasUnsyncedChanges(storage: Storage | null, userId: string): boolean {
  const meta = readJson(storage, syncMetaKey(userId)) as Partial<SyncMeta> | null;
  if (!meta) return false;
  return (
    (Array.isArray(meta.dirtyLeagues) && meta.dirtyLeagues.length > 0) ||
    (Array.isArray(meta.deletedLeagues) && meta.deletedLeagues.length > 0) ||
    Object.values(meta.drafts ?? {}).some((d) => d?.dirty)
  );
}

const DEFAULT_RETRY_DELAYS = [2_000, 5_000, 15_000, 60_000];

/** Thrown for responses the queue should retry later (network failure, timeout, 5xx). */
class RetryLater extends Error {}
/** Thrown when the session is gone (401). */
class SignedOut extends Error {}

export function createServerStores(options: ServerStoreOptions): Stores {
  const { userId, onSyncIssue } = options;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const cache = createLocalStores(storage, { namespace: userId });
  const metaKey = syncMetaKey(userId);
  const dismissedKey = `${storageKeys(userId).prefix}:import-dismissed`;

  /* ---------- sync metadata ---------- */

  const readMeta = (): SyncMeta => {
    const raw = readJson(storage, metaKey) as Partial<SyncMeta> | null;
    return {
      drafts: raw?.drafts && typeof raw.drafts === "object" ? raw.drafts : {},
      dirtyLeagues: Array.isArray(raw?.dirtyLeagues) ? raw.dirtyLeagues : [],
      deletedLeagues: Array.isArray(raw?.deletedLeagues) ? raw.deletedLeagues : [],
    };
  };
  const updateMeta = (fn: (meta: SyncMeta) => void) => {
    const meta = readMeta();
    fn(meta);
    writeJson(storage, metaKey, meta);
  };
  const addUnique = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);

  /* ---------- issue reporting ---------- */

  let offlineReported = false;
  const report = (issue: SyncIssue) => {
    if (issue.kind === "offline") {
      if (offlineReported) return;
      offlineReported = true;
    }
    onSyncIssue?.(issue);
  };

  /* ---------- HTTP ---------- */

  async function request(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    let response: Response;
    try {
      response = await doFetch(path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new RetryLater();
    }
    if (response.status === 401) throw new SignedOut();
    if (response.status >= 500) throw new RetryLater();
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, data };
  }

  /* ---------- push queue ---------- */

  const running = new Map<string, Promise<void>>();
  const rerun = new Set<string>();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;

  function scheduleRetry() {
    if (retryTimer !== undefined) return;
    const delay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];
    retryAttempt++;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void pushAll();
    }, delay);
  }

  /** Runs `task` for `key`, or queues one more run if it's already in flight. */
  function enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const current = running.get(key);
    if (current) {
      rerun.add(key);
      return current;
    }
    const run = (async () => {
      do {
        rerun.delete(key);
        try {
          await task();
          retryAttempt = 0;
          offlineReported = false;
        } catch (error) {
          if (error instanceof SignedOut) report({ kind: "signed-out" });
          else {
            report({ kind: "offline" });
            scheduleRetry();
          }
          // Stop unless someone asked for another run while this one was failing (e.g. flush()).
          if (!rerun.has(key)) break;
        }
      } while (rerun.has(key));
    })().finally(() => running.delete(key));
    running.set(key, run);
    return run;
  }

  async function pushLeague(id: string): Promise<void> {
    if (!readMeta().dirtyLeagues.includes(id)) return;
    const league = await cache.league.getLeague(id);
    if (!league) {
      updateMeta((m) => void (m.dirtyLeagues = m.dirtyLeagues.filter((l) => l !== id)));
      return;
    }
    const { status, data } = await request("PUT", `${API}/${encodeURIComponent(id)}`, league);
    if (status === 200) {
      const saved = parseLeagueRecord((data as { league?: unknown } | null)?.league);
      const latest = await cache.league.getLeague(id);
      // Keep local edits made while the request was in flight; they'll push on the next run.
      if (latest && latest.updatedAt === league.updatedAt) {
        if (saved) await cache.league.saveLeague(saved);
        updateMeta((m) => void (m.dirtyLeagues = m.dirtyLeagues.filter((l) => l !== id)));
      } else {
        rerun.add(`league:${id}`);
      }
    } else if (status === 404) {
      updateMeta((m) => {
        m.dirtyLeagues = m.dirtyLeagues.filter((l) => l !== id);
        delete m.drafts[id];
      });
      report({ kind: "gone", leagueId: id });
    } else {
      // 400/422 won't succeed on retry; stop pushing it and keep the local copy.
      updateMeta((m) => void (m.dirtyLeagues = m.dirtyLeagues.filter((l) => l !== id)));
    }
  }

  async function pushDraft(id: string): Promise<void> {
    // A league created on this device must exist on the server before its draft can be saved.
    if (readMeta().dirtyLeagues.includes(id)) await pushLeague(id);
    for (let attempt = 0; attempt < 3; attempt++) {
      const entry = readMeta().drafts[id];
      if (!entry?.dirty) return;
      const state = (await cache.draft.getDraftState(id)) ?? emptyDraftState();
      const sent = JSON.stringify(state);
      const { status, data } = await request("PUT", `${API}/${encodeURIComponent(id)}/draft`, { state, baseRevision: entry.revision });
      const revision = (data as { revision?: unknown } | null)?.revision;

      if (status === 200 && typeof revision === "number") {
        const unchanged = JSON.stringify((await cache.draft.getDraftState(id)) ?? emptyDraftState()) === sent;
        updateMeta((m) => void (m.drafts[id] = { revision, dirty: !unchanged }));
        if (unchanged) return;
        continue; // picks logged while the request was in flight
      }
      if (status === 409 && typeof revision === "number") {
        updateMeta((m) => void (m.drafts[id] = { revision, dirty: true }));
        report({ kind: "conflict", leagueId: id });
        continue;
      }
      if (status === 404) {
        updateMeta((m) => void delete m.drafts[id]);
        report({ kind: "gone", leagueId: id });
        return;
      }
      // 400: this state will never be accepted. Stop retrying it.
      updateMeta((m) => void (m.drafts[id] = { ...entry, dirty: false }));
      return;
    }
  }

  async function pushDelete(id: string): Promise<void> {
    if (!readMeta().deletedLeagues.includes(id)) return;
    const { status } = await request("DELETE", `${API}/${encodeURIComponent(id)}`);
    // 404: already gone (never synced, or deleted elsewhere). Either way, done.
    if (status === 204 || status === 404) {
      updateMeta((m) => void (m.deletedLeagues = m.deletedLeagues.filter((l) => l !== id)));
    }
  }

  const syncLeague = (id: string) => enqueue(`league:${id}`, () => pushLeague(id));
  const syncDraft = (id: string) => enqueue(`draft:${id}`, () => pushDraft(id));
  const syncDelete = (id: string) => enqueue(`delete:${id}`, () => pushDelete(id));

  async function pushAll(): Promise<void> {
    const meta = readMeta();
    await Promise.all([
      ...meta.deletedLeagues.map(syncDelete),
      ...meta.dirtyLeagues.map(syncLeague),
      ...Object.entries(meta.drafts)
        .filter(([, d]) => d.dirty)
        .map(([id]) => syncDraft(id)),
    ]);
  }

  const hasUnsynced = () => {
    const meta = readMeta();
    return meta.deletedLeagues.length > 0 || meta.dirtyLeagues.length > 0 || Object.values(meta.drafts).some((d) => d.dirty);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => void pushAll());
  }
  // Pick up anything left unsynced by a previous visit.
  if (hasUnsynced()) queueMicrotask(() => void pushAll());

  /* ---------- stores ---------- */

  async function saveDraft(id: string, state: DraftState): Promise<void> {
    // Providers save right after loading; re-saving an unchanged draft would only bump the revision.
    const cached = await cache.draft.getDraftState(id);
    if (cached && JSON.stringify(cached) === JSON.stringify(state) && readMeta().drafts[id]) return;
    await cache.draft.saveDraftState(id, state);
    updateMeta((m) => void (m.drafts[id] = { revision: m.drafts[id]?.revision ?? 0, dirty: true }));
    void syncDraft(id);
  }

  const stores: Stores = {
    prefs: cache.prefs,

    league: {
      async listLeagues() {
        const meta = readMeta();
        const local = await cache.league.listLeagues();
        let remote: LeagueRecord[];
        try {
          const { status, data } = await request("GET", API);
          const raw = (data as { leagues?: unknown } | null)?.leagues;
          if (status !== 200 || !Array.isArray(raw)) return local;
          remote = raw.map(parseLeagueRecord).filter((l): l is LeagueRecord => l !== null);
          offlineReported = false;
        } catch (error) {
          report(error instanceof SignedOut ? { kind: "signed-out" } : { kind: "offline" });
          return local;
        }

        const localById = new Map(local.map((l) => [l.id, l]));
        const merged: LeagueRecord[] = [];
        for (const league of remote) {
          if (meta.deletedLeagues.includes(league.id)) continue;
          const mine = localById.get(league.id);
          merged.push(mine && meta.dirtyLeagues.includes(league.id) && mine.updatedAt > league.updatedAt ? mine : league);
        }
        const remoteIds = new Set(remote.map((l) => l.id));
        for (const league of local) {
          if (remoteIds.has(league.id)) continue;
          // Not on the server: keep it if it was created here and hasn't synced yet; otherwise it was deleted elsewhere.
          if (meta.dirtyLeagues.includes(league.id)) merged.push(league);
          else {
            await cache.league.deleteLeague(league.id);
            updateMeta((m) => void delete m.drafts[league.id]);
          }
        }
        merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        for (const league of merged) await cache.league.saveLeague(league);
        void pushAll();
        return merged;
      },
      async getLeague(id) {
        return cache.league.getLeague(id);
      },
      async saveLeague(league) {
        await cache.league.saveLeague(league);
        updateMeta((m) => {
          m.dirtyLeagues = addUnique(m.dirtyLeagues, league.id);
          m.deletedLeagues = m.deletedLeagues.filter((l) => l !== league.id);
        });
        void syncLeague(league.id);
      },
      async deleteLeague(id) {
        await cache.league.deleteLeague(id);
        updateMeta((m) => {
          m.dirtyLeagues = m.dirtyLeagues.filter((l) => l !== id);
          delete m.drafts[id];
          m.deletedLeagues = addUnique(m.deletedLeagues, id);
        });
        void syncDelete(id);
      },
    },

    draft: {
      async getDraftState(id) {
        const cached = await cache.draft.getDraftState(id);
        if (readMeta().drafts[id]?.dirty || readMeta().dirtyLeagues.includes(id)) return cached;
        try {
          const { status, data } = await request("GET", `${API}/${encodeURIComponent(id)}/draft`);
          const body = data as { state?: unknown; revision?: unknown } | null;
          if (status !== 200 || typeof body?.revision !== "number") return cached;
          const remote = body.state === null ? null : migrateDraftState(body.state);
          if (remote) {
            await cache.draft.saveDraftState(id, remote);
            updateMeta((m) => void (m.drafts[id] = { revision: body.revision as number, dirty: false }));
            return remote;
          }
          // Nothing on the server yet: keep (and upload) whatever this device has.
          if (cached) await saveDraft(id, cached);
          return cached;
        } catch (error) {
          report(error instanceof SignedOut ? { kind: "signed-out" } : { kind: "offline" });
          return cached;
        }
      },
      saveDraftState: saveDraft,
      async deletePick(id, index) {
        const state = await cache.draft.getDraftState(id);
        if (!state) return null;
        const next = { ...state, picks: state.picks.filter((_, i) => i !== index) };
        await saveDraft(id, next);
        return next;
      },
      async resetDraft(id) {
        // Saved as an empty draft rather than removed, so the reset syncs like any other change.
        await saveDraft(id, emptyDraftState());
      },
    },

    imports: {
      async pending() {
        const signedOut = createLocalStores(storage, { legacy: options.legacy });
        const local = await signedOut.league.listLeagues();
        if (!local.length) return [];
        const accountIds = new Set((await cache.league.listLeagues()).map((l) => l.id));
        const dismissed = readJson(storage, dismissedKey);
        const skip = new Set(Array.isArray(dismissed) ? dismissed : []);
        return local.filter((l) => !accountIds.has(l.id) && !skip.has(l.id));
      },
      async importLeagues(ids) {
        // Moves, not copies: once in the account cache (and queued to sync), the signed-out copy is removed
        // so the two can't drift apart. Unsynced account changes are never cleared, so nothing is lost offline.
        const signedOut = createLocalStores(storage);
        for (const id of ids) {
          const league = await signedOut.league.getLeague(id);
          if (!league) continue;
          const state = await signedOut.draft.getDraftState(id);
          await stores.league.saveLeague(league);
          if (state) await saveDraft(id, state);
          await signedOut.league.deleteLeague(id);
        }
      },
      async dismiss(ids) {
        const dismissed = readJson(storage, dismissedKey);
        writeJson(storage, dismissedKey, [...new Set([...(Array.isArray(dismissed) ? dismissed : []), ...ids])]);
      },
    },

    sync: {
      async flush() {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        await pushAll();
        // A push may have queued a rerun (edits made mid-request); let those settle too.
        await Promise.all(running.values());
        return !hasUnsynced();
      },
    },
  };
  return stores;
}
