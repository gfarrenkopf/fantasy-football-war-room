import type { Crosswalk } from "@/lib/espn/crosswalk";
import type { OverlayPlan } from "@/lib/espn/overlayPlan";
import { emptyFeed, foldFrames, type DraftFeed } from "@/lib/espn/feed";
import { toLeagueSettings } from "@/lib/espn/league";
import {
  requestActive,
  resolvePicks,
  type DriftReport,
  type EspnLeague,
  type LiveEvent,
  type LivePick,
  type LiveSnapshot,
  type LiveStatus,
  type PickRequestView,
  type ServerClientView,
} from "@/lib/espn/live";

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
  /** A War Room pick is only handed to the bridge this soon after it was made, so a late delivery can't fire on a later turn. */
  deliverWithinMs?: number;
  /** A War Room pick ESPN hasn't confirmed by now has failed; the user picks in ESPN. */
  expireAfterMs?: number;
  /** Ids for pick requests. */
  newId?: () => string;
  /**
   * Frames we couldn't read before the feed is treated as untrustworthy (8.6). ESPN's protocol is
   * unofficial: when it changes, the picks we *can* read are suspect too.
   */
  driftLimit?: number;
}

/** A War Room pick for the bridge to make: send `SELECT <select>` on ESPN's socket. */
export interface BridgeCommand {
  id: string;
  select: number;
}

/** What the bridge reports about the last command it was handed. */
export interface CommandResult {
  id: string;
  sent: boolean;
  reason?: string;
}

/**
 * War Room's own connection to ESPN (Epic 9), when it holds one: sends on ESPN's socket directly
 * instead of waiting for a bridge's next check-in. Each returns false when it couldn't send.
 */
export interface RelaySender {
  select(espnPlayerId: number): boolean;
  /** Replaces ESPN's pick queue with these players, in order. */
  setQueue(espnPlayerIds: readonly number[]): boolean;
}

/** The overlay's turn plan, versioned so a bridge only downloads it when it changed. */
export interface VersionedPlan {
  version: number;
  plan: OverlayPlan;
}

export type IngestResult =
  | { status: 200; have: number; command?: BridgeCommand; plan?: VersionedPlan }
  | { status: 409; have: number }
  | { status: 413 };

export type PickRequestRefusal = "no-bridge" | "bridge-offline" | "not-your-turn" | "taken" | "busy";
export type PickRequestResult = { ok: true; request: PickRequestView } | { ok: false; reason: PickRequestRefusal };

interface Channel {
  scope: RelayScope | null;
  /** Frame logs by bridge session, in the order the sessions appeared. */
  sessions: Map<string, string[]>;
  frameCount: number;
  feed: DraftFeed;
  picks: LivePick[];
  /** When the latest clock frame (SELECTING or CLOCK) arrived, so a snapshot can say how much of `feed.onClock` is left. */
  clockAt: number;
  lastSeen: number | null;
  lastStatus: LiveStatus;
  listeners: Set<Listener>;
  touched: number;
  request: (PickRequestView & { createdAt: number }) | null;
  plan: VersionedPlan | null;
  espnLeague: EspnLeague | null;
  degraded: DriftReport | null;
  serverClient: ServerClientView | null;
  sender: RelaySender | null;
  /** Keep ESPN's queue set to the turn plan (9.3). Only while War Room holds the connection. */
  queueSync: boolean;
  /** ESPN's pick queue as last set from the turn plan, so an unchanged plan isn't sent again. */
  queueSent: string;
}

export interface Relay {
  /** `planVersion` is the overlay plan the bridge already has; a newer one comes back with the result. */
  ingest(scope: RelayScope, session: string, seq: number, frames: readonly string[], result?: CommandResult, planVersion?: number): Promise<IngestResult>;
  /** ESPN's own settings for this draft, as the bridge read them (8.8). */
  setLeague(scope: RelayScope, settings: unknown): void;
  /** Publishes the turn plan from a war room for the league's bridge overlay. False when no bridge is connected. */
  publishPlan(userId: string, leagueId: string, plan: OverlayPlan): boolean;
  /** A pick the user made in War Room, for the bridge to make in ESPN. Refused unless ESPN has the user on the clock. */
  requestPick(userId: string, leagueId: string, pick: { playerId: string; espnPlayerId: number }): PickRequestResult;
  /** Starts watching a league. The snapshot is the draft so far; `listener` gets everything after it. */
  subscribe(userId: string, leagueId: string, listener: Listener): { snapshot: LiveSnapshot; unsubscribe(): void };
  /** Re-checks bridge liveness and tells listeners if it changed. Called periodically by open streams. */
  checkStatus(userId: string, leagueId: string): void;
  snapshot(userId: string, leagueId: string): LiveSnapshot;
  /** The ESPN draft a league's bridge last reported, or null before any bridge has. */
  scope(userId: string, leagueId: string): RelayScope | null;
  /** Where War Room's own ESPN connection for this league stands (Epic 9), for every war room watching. */
  setServerClient(userId: string, leagueId: string, view: ServerClientView | null): void;
  serverClient(userId: string, leagueId: string): ServerClientView | null;
  /** Picks and queue updates go out through `sender` while it's attached (9.3). Returns a detach. */
  attachSender(userId: string, leagueId: string, sender: RelaySender): () => void;
  /** Sets ESPN's pick queue from the latest turn plan, now. The ESPN ids queued, or null with no sender or no plan. */
  pushQueue(userId: string, leagueId: string): number[] | null;
  /** Keeps ESPN's queue set to every new turn plan, or stops. Sets it now when turned on. */
  setQueueSync(userId: string, leagueId: string, on: boolean): number[] | null;
}

/** ESPN's queue from a turn plan: targets, then fallbacks, then the best on the board, each once, none already drafted. */
export function queueFromPlan(plan: OverlayPlan, drafted: ReadonlySet<number>): number[] {
  const ids: number[] = [];
  for (const p of [...plan.targets, ...plan.fallbacks, ...plan.best]) {
    if (p.espnPlayerId !== undefined && !drafted.has(p.espnPlayerId) && !ids.includes(p.espnPlayerId)) ids.push(p.espnPlayerId);
  }
  return ids;
}

const key = (userId: string, leagueId: string) => `${userId}\u0000${leagueId}`;

export function createRelay({
  now = Date.now,
  crosswalkFor,
  fallbackCrosswalk,
  offlineAfterMs = 20_000,
  idleMs = 60 * 60 * 1000,
  maxFrames = 50_000,
  deliverWithinMs = 5_000,
  expireAfterMs = 10_000,
  newId = () => crypto.randomUUID(),
  driftLimit = 20,
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
      ch = {
        scope: null,
        sessions: new Map(),
        frameCount: 0,
        feed: emptyFeed(),
        picks: [],
        clockAt: 0,
        lastSeen: null,
        lastStatus: "waiting",
        listeners: new Set(),
        touched: now(),
        request: null,
        plan: null,
        espnLeague: null,
        degraded: null,
        serverClient: null,
        sender: null,
        queueSync: false,
        queueSent: "",
      };
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
      onClock: clockNow(ch),
      sessions: ch.sessions.size,
      request: viewOf(ch.request),
      espnLeague: ch.espnLeague,
      degraded: ch.degraded,
      serverClient: serverClientOf(ch),
    };
  }

  const serverClientOf = (ch: Channel): ServerClientView | null =>
    ch.serverClient && (ch.queueSync ? { ...ch.serverClient, queueSync: true } : ch.serverClient);

  /** The clock as of now: the last frame's time left, less what has passed since it arrived. */
  function clockNow(ch: Channel): LiveSnapshot["onClock"] {
    const clock = ch.feed.onClock;
    return clock && { teamId: clock.teamId, msRemaining: Math.max(0, clock.msRemaining - (now() - ch.clockAt)) };
  }

  const viewOf = (r: Channel["request"]): PickRequestView | null =>
    r && { id: r.id, playerId: r.playerId, espnPlayerId: r.espnPlayerId, state: r.state, ...(r.reason ? { reason: r.reason } : {}) };

  function settle(ch: Channel, state: PickRequestView["state"], reason?: string) {
    if (!ch.request || !requestActive(ch.request)) return;
    ch.request = { ...ch.request, state, ...(reason ? { reason } : {}) };
    emit(ch, { type: "request", request: viewOf(ch.request)! });
  }

  /** A War Room pick nobody confirmed in time has failed. */
  function expire(ch: Channel) {
    if (ch.request && requestActive(ch.request) && now() - ch.request.createdAt > expireAfterMs) settle(ch, "expired");
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

  /**
   * ESPN's protocol drifting under us, or its socket refusing the connection. Said once per channel:
   * the log line is what `deploy/warroom-alerts.sh` emails on, and the war room hands the board back
   * to the user rather than applying picks it may be reading wrong.
   */
  function checkDrift(ch: Channel, scope: RelayScope) {
    if (ch.degraded) return;
    const { unknownFrames, malformedFrames, error } = ch.feed;
    const unreadable = unknownFrames + malformedFrames;
    const reason = error
      ? `ESPN refused the draft connection: ${error.message}`
      : unreadable >= driftLimit
        ? "ESPN's draft feed changed, so War Room stopped trusting it"
        : null;
    if (!reason) return;
    ch.degraded = { reason, unknownFrames, malformedFrames };
    console.warn(
      `[espn-sync] protocol-drift league=${scope.espnLeagueId} season=${scope.season} unknown=${unknownFrames} malformed=${malformedFrames}` +
        (error ? ` error=${error.code} ${error.message}` : ""),
    );
    emit(ch, { type: "degraded", degraded: ch.degraded });
  }

  /** Sends the turn plan to ESPN's queue if there's a sender, a plan, and something new to send. */
  function pushQueue(ch: Channel, force = false): number[] | null {
    if (!ch.sender || !ch.plan) return null;
    const ids = queueFromPlan(ch.plan.plan, new Set(ch.feed.picks.map((p) => p.espnPlayerId)));
    const serialized = ids.join(" ");
    if (!ids.length || (!force && serialized === ch.queueSent)) return ids;
    if (!ch.sender.setQueue(ids)) return null;
    ch.queueSent = serialized;
    return ids;
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
    ch.request = null;
    ch.plan = null;
    ch.espnLeague = null;
    ch.degraded = null;
  }

  return {
    async ingest(scope, session, seq, frames, result, planVersion = 0) {
      const walk = await crosswalk(scope.season);
      const ch = channel(scope.userId, scope.leagueId);
      // Re-paired to a different ESPN league (or season): that's a different draft.
      if (ch.scope && (ch.scope.espnLeagueId !== scope.espnLeagueId || ch.scope.season !== scope.season)) reset(ch);
      const teamChanged = ch.scope !== null && ch.scope.espnTeamId !== scope.espnTeamId;
      ch.scope = scope;
      ch.lastSeen = now();

      if (result && ch.request?.id === result.id && ch.request.state === "pending") {
        if (result.sent) {
          ch.request = { ...ch.request, state: "sent" };
          emit(ch, { type: "request", request: viewOf(ch.request)! });
        } else settle(ch, "refused", result.reason);
      }

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
        // Every clock frame restarts the countdown, even one that repeats the last (a paused draft).
        const clockMoved = frames.some((f) => f.startsWith("CLOCK ") || f.startsWith("SELECTING ")) || ch.feed.onClock?.teamId !== before.onClock?.teamId;
        if (clockMoved) ch.clockAt = now();
        const fresh = resolvePicks(ch.feed, walk, scope.espnTeamId, rebuilt ? 0 : ch.picks.length);
        ch.picks = rebuilt ? fresh : [...ch.picks, ...fresh];
        if (rebuilt) emit(ch, { type: "snapshot", snapshot: snapshotOf(ch) });
        else for (const pick of fresh) emit(ch, { type: "pick", pick });
        // The user's team just picked: that settles a War Room pick one way or the other.
        for (const pick of fresh) {
          if (pick.teamId === scope.espnTeamId && ch.request && requestActive(ch.request)) {
            settle(ch, pick.espnPlayerId === ch.request.espnPlayerId ? "confirmed" : "superseded");
          }
        }
        // ESPN refused the pick War Room just sent: the socket stays open and the user picks again.
        if (ch.feed.refusedPicks > before.refusedPicks && ch.request?.state === "sent") settle(ch, "refused", "not-on-the-clock");
        if (!rebuilt && clockMoved) emit(ch, { type: "clock", onClock: ch.feed.onClock });
      } else if (teamChanged && ch.picks.length) {
        ch.picks = resolvePicks(ch.feed, walk, scope.espnTeamId);
        emit(ch, { type: "snapshot", snapshot: snapshotOf(ch) });
      }
      checkDrift(ch, scope);
      expire(ch);
      emitStatus(ch);
      const r = ch.request;
      const command = r?.state === "pending" && now() - r.createdAt <= deliverWithinMs ? { id: r.id, select: r.espnPlayerId } : undefined;
      const plan = ch.plan && ch.plan.version > planVersion ? ch.plan : undefined;
      return { status: 200, have: log.length, ...(command ? { command } : {}), ...(plan ? { plan } : {}) };
    },

    setLeague(scope, settings) {
      const ch = channel(scope.userId, scope.leagueId);
      const imported = toLeagueSettings(settings, scope.espnTeamId);
      const base: EspnLeague = imported.ok ? { ok: true, settings: imported.league } : { ok: false, error: imported.error };
      // A moved draft is a change worth telling the war room about too.
      const espnLeague: EspnLeague = imported.draftAt ? { ...base, draftAt: imported.draftAt } : base;
      // ESPN redraws the draft order when the lobby opens, so this arrives more than once; only a
      // real change is worth telling the war room about.
      if (JSON.stringify(espnLeague) === JSON.stringify(ch.espnLeague)) return;
      ch.espnLeague = espnLeague;
      emit(ch, { type: "league", espnLeague });
    },

    publishPlan(userId, leagueId, plan) {
      const ch = channels.get(key(userId, leagueId));
      if (!ch?.scope) return false;
      ch.plan = { version: (ch.plan?.version ?? 0) + 1, plan };
      if (ch.queueSync) pushQueue(ch);
      return true;
    },

    requestPick(userId, leagueId, pick) {
      const ch = channels.get(key(userId, leagueId));
      if (!ch?.scope) return { ok: false, reason: "no-bridge" };
      expire(ch);
      if (statusOf(ch) !== "live") return { ok: false, reason: "bridge-offline" };
      if (ch.feed.onClock?.teamId !== ch.scope.espnTeamId) return { ok: false, reason: "not-your-turn" };
      if (ch.feed.picks.some((p) => p.espnPlayerId === pick.espnPlayerId)) return { ok: false, reason: "taken" };
      if (requestActive(ch.request)) return { ok: false, reason: "busy" };
      ch.request = { id: newId(), playerId: pick.playerId, espnPlayerId: pick.espnPlayerId, state: "pending", createdAt: now() };
      emit(ch, { type: "request", request: viewOf(ch.request)! });
      // War Room holds the ESPN connection itself: the pick goes out now, not on a bridge's next check-in.
      if (ch.sender?.select(pick.espnPlayerId)) {
        ch.request = { ...ch.request, state: "sent" };
        emit(ch, { type: "request", request: viewOf(ch.request)! });
      }
      return { ok: true, request: viewOf(ch.request)! };
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
      if (!ch) return;
      expire(ch);
      emitStatus(ch);
    },

    snapshot(userId, leagueId) {
      return snapshotOf(channel(userId, leagueId));
    },

    scope(userId, leagueId) {
      return channels.get(key(userId, leagueId))?.scope ?? null;
    },

    setServerClient(userId, leagueId, view) {
      const ch = channel(userId, leagueId);
      // Queue syncing only means something while War Room holds the connection.
      if (view?.state !== "holding" && view?.state !== "connecting") ch.queueSync = false;
      if (JSON.stringify(view) === JSON.stringify(ch.serverClient)) return;
      ch.serverClient = view;
      emit(ch, { type: "serverClient", serverClient: serverClientOf(ch) });
    },

    serverClient(userId, leagueId) {
      const ch = channels.get(key(userId, leagueId));
      return ch ? serverClientOf(ch) : null;
    },

    attachSender(userId, leagueId, sender) {
      const ch = channel(userId, leagueId);
      ch.sender = sender;
      ch.queueSent = "";
      return () => {
        if (ch.sender === sender) ch.sender = null;
      };
    },

    pushQueue(userId, leagueId) {
      return pushQueue(channel(userId, leagueId), true);
    },

    setQueueSync(userId, leagueId, on) {
      const ch = channel(userId, leagueId);
      if (on && !ch.sender) return null;
      const ids = on ? pushQueue(ch, true) : null;
      if (ch.queueSync !== on) {
        ch.queueSync = on;
        emit(ch, { type: "serverClient", serverClient: serverClientOf(ch) });
      }
      return ids;
    },
  };
}
