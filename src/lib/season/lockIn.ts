import { madeMoves, type SuggestedMove } from "./apply";
import { lineupEmphasis, type Emphasis } from "./emphasis";
import type { LineupMove } from "./lineup";
import type { LineupSlot } from "./types";

/**
 * The moment a lineup with War Room's moves in it lands on ESPN (APE-294). It plays only when every
 * move the user sent landed and at least one was War Room's: a failed move is serious, and a lineup
 * made only of the user's own moves gets the plain "Done". Gains are projections, never results.
 */

/** A starting seat the user filled themselves, and what it does to the projection. */
export interface OwnMove {
  playerId: number;
  to: LineupSlot;
  delta: number;
}

export interface LockIn {
  /** Projected points War Room's landed moves add this week. */
  banked: number;
  warRoom: (LineupMove & { gain: number })[];
  own: OwnMove[];
  /** The ladder step of what was banked: it sets the moment's size. */
  level: Emphasis;
  /** ESPN's projected total before the apply, and after it. */
  before: number;
  after: number;
  /** What War Room's lineup would still add, as the user sent it. */
  leftover: number;
  /** Confetti: a big gain banked, with no big gain left behind. Once a week is the caller's to keep. */
  confetti: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function lockIn({
  landed,
  suggested,
  own,
  before,
  after,
  recommended,
}: {
  landed: readonly (LineupMove & { landed: boolean })[];
  suggested: readonly SuggestedMove[];
  own: readonly OwnMove[];
  before: number;
  after: number;
  /** War Room's lineup's projected total. */
  recommended: number;
}): LockIn | null {
  if (!landed.length || landed.some((m) => !m.landed)) return null;
  const warRoom = madeMoves(landed, suggested);
  if (!warRoom.length) return null;
  const banked = round(warRoom.reduce((sum, m) => sum + m.gain, 0));
  const leftover = Math.max(0, round(recommended - after));
  const level = lineupEmphasis(banked);
  const big = (e: Emphasis) => e === "swing" || e === "must";
  return {
    banked,
    warRoom,
    own: [...own],
    level,
    before,
    after,
    leftover,
    confetti: big(level) && !big(lineupEmphasis(leftover)),
  };
}

/** The moment's headline, on the ladder step of what was banked. */
export function lockInHeadline(level: Emphasis, banked: number): string {
  switch (level) {
    case "must":
      return `${banked.toFixed(1)} points off your bench`;
    case "swing":
      return "Big swing, banked";
    case "gain":
      return "Lineup locked";
    default:
      return "Lineup locked. Every point counts";
  }
}
