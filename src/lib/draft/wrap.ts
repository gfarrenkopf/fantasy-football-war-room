import { isStarterSlot, slotLabel, starterByeCounts, type FilledSlot, type RosteredPlayer } from "./roster";
import { formatRoundPick } from "./snake";
import { LATE_POSITIONS } from "./types";

/** One of the user's players as the draft-complete reveal shows it. */
export interface WrapPick {
  /** Roster slot: "QB", "WR2", "FLEX", "Bench". */
  slot: string;
  player: RosteredPlayer;
  /** Round.pick, e.g. "4.07". */
  roundPick: string;
  /**
   * How many picks after the consensus rank the user got him: positive means he fell to them.
   * Null for K and D/ST, whose ranks are too noisy to judge (the same rule as Value/Reach tags).
   */
  gain: number | null;
}

/** Everything the draft-complete reveal says about the user's team. Every number is theirs. */
export interface DraftWrap {
  /** Filled starter slots in lineup order (the league's roster order). */
  starters: WrapPick[];
  bench: WrapPick[];
  /** The pick with the largest positive gain, or null when nobody fell. */
  steal: WrapPick | null;
  /** Fallback headline when there is no steal: the best player by consensus rank. */
  best: WrapPick | null;
  /** Picks that came after the consensus rank (`k`) out of the picks that can be judged (`n`). */
  beat: { k: number; n: number };
  /** Bye weeks with two or more bye-relevant starters out, ascending. */
  stacked: { week: number; n: number }[];
}

/** Builds the reveal from the user's final roster. Ported from nothing: the prototype never finished a draft. */
export function draftWrap(slots: FilledSlot[], teams: number, byeWeeks: number[]): DraftWrap {
  const pick = (s: FilledSlot): WrapPick => {
    const player = s.player!;
    return {
      slot: slotLabel(slots, player.id) ?? "Bench",
      player,
      roundPick: formatRoundPick(player.pickNo, teams),
      gain: LATE_POSITIONS.includes(player.pos) ? null : player.pickNo - player.consensusRank,
    };
  };
  const filled = slots.filter((s) => s.player);
  const starters = filled.filter((s) => isStarterSlot(s.slot)).map(pick);
  const bench = filled.filter((s) => !isStarterSlot(s.slot)).map(pick);
  const all = [...starters, ...bench];
  const judged = all.filter((p) => p.gain !== null);

  const steal = judged.reduce<WrapPick | null>((top, p) => (p.gain! > 0 && (!top || p.gain! > top.gain!) ? p : top), null);
  const best = all.reduce<WrapPick | null>((top, p) => (!top || p.player.consensusRank < top.player.consensusRank ? p : top), null);

  return {
    starters,
    bench,
    steal,
    best,
    beat: { k: judged.filter((p) => p.gain! > 0).length, n: judged.length },
    stacked: starterByeCounts(slots, byeWeeks).filter((c) => c.n >= 2),
  };
}
