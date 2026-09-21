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
}

export type LiveEvent =
  | { type: "snapshot"; snapshot: LiveSnapshot }
  | { type: "pick"; pick: LivePick }
  | { type: "clock"; onClock: LiveSnapshot["onClock"] }
  | { type: "status"; status: LiveStatus; draft: FeedStatus };

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
