import type { Crosswalk, OffBoardPlayer } from "./crosswalk";
import type { DraftFeed, FeedStatus } from "./feed";

/**
 * What the war room receives from the relay (8.9): the ESPN draft as picks already resolved to the
 * war room's players. Shared by the server (which builds it) and the client (which applies it).
 */

export interface LivePick {
  /** 1-based pick number; only a real pick number when the snapshot is `anchored`. */
  n: number;
  /** ESPN team id. */
  teamId: number;
  /** The user's own team made this pick. */
  mine: boolean;
  auto: boolean;
  espnPlayerId: number;
  /** The war room player, or null when the player is off the board. */
  playerId: string | null;
  /** Set when `playerId` is null: enough to show who was taken. */
  offBoard: OffBoardPlayer | null;
}

/**
 * - `waiting`: no bridge has connected yet.
 * - `live`: the bridge is connected and the draft hasn't finished.
 * - `bridge-offline`: the bridge stopped checking in (ESPN tab closed or asleep).
 * - `complete`: ESPN says the draft is over.
 */
export type LiveStatus = "waiting" | "live" | "bridge-offline" | "complete";

/**
 * A pick the user made from War Room, on its way into ESPN (8.13):
 * - `pending`: waiting for the bridge's next check-in to carry it.
 * - `sent`: the bridge sent it on ESPN's socket; waiting for ESPN to announce it.
 * - `confirmed`: ESPN announced the pick.
 * - `superseded`: the user's team picked someone else first (in ESPN, or autopick).
 * - `refused`: the bridge wouldn't send it, e.g. ESPN no longer had the user on the clock.
 * - `expired`: nothing confirmed it in time; the user should pick in ESPN.
 */
export type PickRequestState = "pending" | "sent" | "confirmed" | "superseded" | "refused" | "expired";

export interface PickRequestView {
  id: string;
  playerId: string;
  espnPlayerId: number;
  state: PickRequestState;
  reason?: string;
}

export const requestActive = (r: Pick<PickRequestView, "state"> | null): boolean => r?.state === "pending" || r?.state === "sent";

export interface LiveSnapshot {
  status: LiveStatus;
  /** The draft's own state as the socket showed it, independent of the bridge. */
  draft: FeedStatus;
  anchored: boolean;
  /** The user's ESPN team, once a bridge has connected. */
  espnTeamId: number | null;
  picks: LivePick[];
  onClock: { teamId: number; msRemaining: number } | null;
  /** How many separate page loads of the ESPN tab contributed frames. More than one may mean a gap. */
  sessions: number;
  /** The latest pick made from War Room, if any. */
  request: PickRequestView | null;
}

export type LiveEvent =
  | { type: "snapshot"; snapshot: LiveSnapshot }
  | { type: "pick"; pick: LivePick }
  | { type: "clock"; onClock: LiveSnapshot["onClock"] }
  | { type: "status"; status: LiveStatus; draft: FeedStatus }
  | { type: "request"; request: PickRequestView };

/** Resolves the feed's picks from `from` onward (earlier ones are already resolved). */
export function resolvePicks(feed: DraftFeed, crosswalk: Crosswalk, espnTeamId: number | null, from = 0): LivePick[] {
  return feed.picks.slice(from).map((p) => {
    const r = crosswalk(p.espnPlayerId);
    return {
      n: p.overall,
      teamId: p.teamId,
      mine: espnTeamId !== null && p.teamId === espnTeamId,
      auto: p.auto,
      espnPlayerId: p.espnPlayerId,
      playerId: r.kind === "matched" ? r.playerId : null,
      offBoard: r.kind === "offBoard" ? r.player : null,
    };
  });
}

/** ESPN's pick clock as a local deadline: the time left when it arrived, on this device's own clock, so server skew doesn't matter. */
export interface ClockDeadline {
  teamId: number;
  /** `Date.now()` value at which the pick is due. */
  deadline: number;
}

export const clockDeadline = (onClock: LiveSnapshot["onClock"], receivedAt: number): ClockDeadline | null =>
  onClock && { teamId: onClock.teamId, deadline: receivedAt + onClock.msRemaining };

/** "1:05", "0:09"; never negative. Rounds up, so "0:01" shows until the clock really runs out. */
export function formatClock(ms: number): string {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export type ClockUrgency = "ok" | "low" | "urgent";

export const clockUrgency = (ms: number): ClockUrgency => (ms <= 10_000 ? "urgent" : ms <= 30_000 ? "low" : "ok");
