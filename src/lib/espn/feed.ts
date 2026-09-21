import { parseFrame, type EspnFrame } from "./protocol";

/**
 * Folds ESPN draft-socket frames into the draft as the socket has shown it.
 *
 * Pure and deterministic: the same frames always give the same feed. The server rebuilds a
 * channel by re-folding the bridge's whole frame log (after a restart, say), so nothing here
 * may depend on time or on how the frames were batched.
 */

export interface FeedPick {
  /** 1-based overall pick number: the running count of SELECTED frames. */
  overall: number;
  /** ESPN team id, not a draft slot. */
  teamId: number;
  espnPlayerId: number;
  /** True for an autopick. ESPN names the drafter's member on a human pick and never on an autopick. */
  auto: boolean;
}

export type FeedStatus = "waiting" | "live" | "complete";

export interface DraftFeed {
  status: FeedStatus;
  picks: FeedPick[];
  /** Team on the clock and its time left, from the latest SELECTING or CLOCK frame. */
  onClock: { teamId: number; msRemaining: number } | null;
  /** Teams with autopick switched on. */
  autodraft: number[];
  /** The latest ERROR frame, if any. ESPN closes the socket after one. */
  error: { code: number; message: string } | null;
  /** Frames we couldn't make sense of, for drift detection. */
  unknownFrames: number;
  malformedFrames: number;
}

export const emptyFeed = (): DraftFeed => ({
  status: "waiting",
  picks: [],
  onClock: null,
  autodraft: [],
  error: null,
  unknownFrames: 0,
  malformedFrames: 0,
});

export function applyFrame(feed: DraftFeed, frame: EspnFrame): DraftFeed {
  switch (frame.kind) {
    case "state":
      if (frame.state === 2) return { ...feed, status: "complete", onClock: null };
      if (frame.state === 1 && feed.status === "waiting") return { ...feed, status: "live" };
      return feed;
    case "selecting":
      return { ...feed, status: feed.status === "waiting" ? "live" : feed.status, onClock: { teamId: frame.teamId, msRemaining: frame.msAllowed } };
    case "clock":
      // Team 0 is the pre-draft countdown, not a team on the clock.
      return frame.teamId === 0 ? feed : { ...feed, onClock: { teamId: frame.teamId, msRemaining: frame.msRemaining } };
    case "autodraft": {
      const others = feed.autodraft.filter((t) => t !== frame.teamId);
      return { ...feed, autodraft: frame.on ? [...others, frame.teamId].sort((a, b) => a - b) : others };
    }
    case "selected": {
      const pick: FeedPick = {
        overall: feed.picks.length + 1,
        teamId: frame.teamId,
        espnPlayerId: frame.playerId,
        auto: frame.memberId === null,
      };
      return { ...feed, status: feed.status === "complete" ? "complete" : "live", picks: [...feed.picks, pick] };
    }
    case "error":
      return { ...feed, error: { code: frame.code, message: frame.message } };
    case "unknown":
      return { ...feed, unknownFrames: feed.unknownFrames + 1 };
    case "malformed":
      return { ...feed, malformedFrames: feed.malformedFrames + 1 };
    default:
      return feed;
  }
}

/** Parses and folds raw frame text, e.g. the bridge's frame log. */
export const foldFrames = (frames: readonly string[], from: DraftFeed = emptyFeed()): DraftFeed =>
  frames.reduce((feed, raw) => applyFrame(feed, parseFrame(raw)), from);
