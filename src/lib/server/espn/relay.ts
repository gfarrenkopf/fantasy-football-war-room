import type { Crosswalk } from "@/lib/espn/crosswalk";
import { emptyFeed, foldFrames, type DraftFeed } from "@/lib/espn/feed";
import { resolvePicks, type LiveEvent, type LivePick, type LiveSnapshot, type LiveStatus } from "@/lib/espn/live";

/**
 * The relay (8.9): frames in from a bridge, resolved picks out to every war room open on that league.
 *
 * One channel per user and war room league, held in memory. Frames arrive per bridge session (one
 * page load of the ESPN tab), each an append-only log addressed by offset, so a bridge can always
 * tell what the relay holds and resend from exactly there, e.g. after a deploy restarts the process.
 * The draft is the fold of every session's log in the order the sessions appeared.
 *
 * Nothing here touches the database, the network or `config`; dependencies are injected so tests
 * can drive it with a fake clock and crosswalk.
 */

export interface RelayScope {
  userId: string;
  leagueId: string;
  espnLeagueId: string;
  espnTeamId: number;
  season: number;
}

export type Listener = (event: LiveEvent) => void;

export interface RelayOptions {
  now?: () => number;
  /** The crosswalk for a season. Called once per season; a rejection falls back to `fallbackCrosswalk`. */
  crosswalkFor: (season: number) => Promise<Crosswalk>;
  /** Used when `crosswalkFor` fails: everything the pool would have named goes off the board unnamed. */
  fallbackCrosswalk: Crosswalk;
  /** A bridge that hasn't checked in for this long is offline. It heartbeats every 5s. */
  offlineAfterMs?: number;
  /** Channels nobody is watching and no bridge has fed for this long are dropped. */
  idleMs?: number;
  /** Frames kept per channel; a runaway bridge is refused past this. */
  maxFrames?: number;
}

export type IngestResult = { status: 200; have: number } | { status: 409; have: number } | { status: 413 };

interface Channel {
  scope: RelayScope | null;
  /** Frame logs by bridge session, in the order the sessions appeared. */
  sessions: Map<string, string[]>;
  frameCount: number;
  feed: DraftFeed;
  picks: LivePick[];
  lastSeen: number | null;
  lastStatus: LiveStatus;
  listeners: Set<Listener>;
  touched: number;
}

export interface Relay {
  ingest(scope: RelayScope, session: string, seq: number, frames: readonly string[]): Promise<IngestResult>;
  /** Starts watching a league. The snapshot is the draft so far; `listener` gets everything after it. */
  subscribe(userId: string, leagueId: string, listener: Listener): { snapshot: LiveSnapshot; unsubscribe(): void };
  /** Re-checks bridge liveness and tells listeners if it changed. Called periodically by open streams. */
  checkStatus(userId: string, leagueId: string): void;
  snapshot(userId: string, leagueId: string): LiveSnapshot;
}

const key = (userId: string, leagueId: string) => `${userId}\u0000${leagueId}`;

export function createRelay({
  now = Date.now,
  crosswalkFor,
  fallbackCrosswalk,
  offlineAfterMs = 20_000,
  idleMs = 60 * 60 * 1000,
  maxFrames = 50_000,
}: RelayOptions): Relay {
  const channels = new Map<string, Channel>();
  const crosswalks = new Map<number, Promise<Crosswalk>>();

  function crosswalk(season: number): Promise<Crosswalk> {
    let pending = crosswalks.get(season);
    if (!pending) {
      pending = crosswalkFor(season).catch((err: unknown) => {
        console.warn(`[espn-sync] no ESPN player list for ${season}, picks will be unnamed: ${(err as Error).message}`);
        crosswalks.delete(season); // try again on the next frames
        return fallbackCrosswalk;
      });
      crosswalks.set(season, pending);
    }
    return pending;
  }

  function sweep() {
    const t = now();
    for (const [k, ch] of channels) {
      if (!ch.listeners.size && t - Math.max(ch.touched, ch.lastSeen ?? 0) > idleMs) channels.delete(k);
    }
  }

  function channel(userId: string, leagueId: string): Channel {
    const k = key(userId, leagueId);
    let ch = channels.get(k);
    if (!ch) {
      sweep();
      ch = { scope: null, sessions: new Map(), frameCount: 0, feed: emptyFeed(), picks: [], lastSeen: null, lastStatus: "waiting", listeners: new Set(), touched: now() };
      channels.set(k, ch);
    }
    ch.touched = now();
    return ch;
  }

  function statusOf(ch: Channel): LiveStatus {
    if (ch.lastSeen === null) return "waiting";
    if (ch.feed.status === "complete") return "complete";
    return now() - ch.lastSeen > offlineAfterMs ? "bridge-offline" : "live";
  }

  function snapshotOf(ch: Channel): LiveSnapshot {
    return {
      status: statusOf(ch),
      draft: ch.feed.status,
      anchored: ch.feed.anchored,
      espnTeamId: ch.scope?.espnTeamId ?? null,
      picks: ch.picks,
      onClock: ch.feed.onClock,
      sessions: ch.sessions.size,
    };
  }

  function emit(ch: Channel, event: LiveEvent) {
    for (const listener of ch.listeners) {
      try {
        listener(event);
      } catch {
        ch.listeners.delete(listener); // a closed stream; its own cleanup will follow
      }
    }
  }

  function emitStatus(ch: Channel) {
    const status = statusOf(ch);
    if (status === ch.lastStatus) return;
    ch.lastStatus = status;
    emit(ch, { type: "status", status, draft: ch.feed.status });
  }

  function reset(ch: Channel) {
    ch.sessions.clear();
    ch.frameCount = 0;
    ch.feed = emptyFeed();
    ch.picks = [];
  }

  return {
    async ingest(scope, session, seq, frames) {
      const walk = await crosswalk(scope.season);
      const ch = channel(scope.userId, scope.leagueId);
      // Re-paired to a different ESPN league (or season): that's a different draft.
      if (ch.scope && (ch.scope.espnLeagueId !== scope.espnLeagueId || ch.scope.season !== scope.season)) reset(ch);
      const teamChanged = ch.scope !== null && ch.scope.espnTeamId !== scope.espnTeamId;
      ch.scope = scope;
      ch.lastSeen = now();

      let log = ch.sessions.get(session);
      if (!log) ch.sessions.set(session, (log = []));
      if (seq !== log.length) {
        emitStatus(ch);
        return { status: 409, have: log.length };
      }
      if (ch.frameCount + frames.length > maxFrames) return { status: 413 };

      if (frames.length) {
        const latest = [...ch.sessions.keys()].at(-1) === session;
        log.push(...frames);
        ch.frameCount += frames.length;
        const before = ch.feed;
        // Appending to the newest session folds incrementally; frames for an older one (two tabs
        // bridging at once) change the order, so the whole draft is refolded.
        ch.feed = latest ? foldFrames(frames, ch.feed) : foldFrames([...ch.sessions.values()].flat());
        const rebuilt = !latest || teamChanged;
        const fresh = resolvePicks(ch.feed, walk, scope.espnTeamId, rebuilt ? 0 : ch.picks.length);
        ch.picks = rebuilt ? fresh : [...ch.picks, ...fresh];
        if (rebuilt) emit(ch, { type: "snapshot", snapshot: snapshotOf(ch) });
        else for (const pick of fresh) emit(ch, { type: "pick", pick });
        const clock = ch.feed.onClock;
        if (!rebuilt && (clock?.teamId !== before.onClock?.teamId || clock?.msRemaining !== before.onClock?.msRemaining)) {
          emit(ch, { type: "clock", onClock: clock });
        }
      } else if (teamChanged && ch.picks.length) {
        ch.picks = resolvePicks(ch.feed, walk, scope.espnTeamId);
        emit(ch, { type: "snapshot", snapshot: snapshotOf(ch) });
      }
      emitStatus(ch);
      return { status: 200, have: log.length };
    },

    subscribe(userId, leagueId, listener) {
      const ch = channel(userId, leagueId);
      ch.listeners.add(listener);
      ch.lastStatus = statusOf(ch);
      return {
        snapshot: snapshotOf(ch),
        unsubscribe: () => {
          ch.listeners.delete(listener);
          ch.touched = now();
        },
      };
    },

    checkStatus(userId, leagueId) {
      const ch = channels.get(key(userId, leagueId));
      if (ch) emitStatus(ch);
    },

    snapshot(userId, leagueId) {
      return snapshotOf(channel(userId, leagueId));
    },
  };
}
