import { label } from "@/lib/season/apply";
import type { Emphasis } from "@/lib/season/emphasis";
import type { LineupMove } from "@/lib/season/lineup";
import type { LineupTarget } from "@/lib/season/lineupTarget";
import { lockInHeadline } from "@/lib/season/lockIn";

/**
 * POST /api/v1/leagues/:id/lineup (APE-381): the iPhone app's confirm sheet and its results, in plain
 * words, so the app shows them without working anything out itself.
 */

/** `?dryRun=1`: every change the lineup makes, ticked or not, and why the ticked ones can't go to ESPN. */
export interface LineupDryRun {
  changes: { id: string; text: string; picked: boolean; moves: LineupMove[] }[];
  problems: string[];
}

/** After the write: each change that was sent, and whether ESPN shows it. */
export interface LineupApplied {
  changes: { id: string; text: string; landed: boolean; result: string; moves: (LineupMove & { landed: boolean })[] }[];
  /** The Lock In moment (APE-294), when everything landed and War Room's moves were among it; null otherwise. */
  lockIn: LockInMoment | null;
}

/** The Lock In moment, in the app's words. Gains are projections. */
export interface LockInMoment {
  /** Projected points War Room's moves add this week. */
  banked: number;
  /** ESPN's projected total before the apply, and after. */
  before: number;
  after: number;
  /** What War Room's lineup would still add. */
  leftover: number;
  /** The ladder step of what was banked (rest, trim, gain, swing, must): it sets the moment's size. */
  level: Emphasis;
  headline: string;
  /** A big gain banked with none left behind: the confetti. Once a week per league is the app's to keep. */
  confetti: boolean;
  /** War Room's moves, then the user's own ("Your call"), each with what it does to the projection. */
  moves: { playerId: number; text: string; gain: number; own: boolean }[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export const dryRunResponse = (target: LineupTarget): LineupDryRun => ({ changes: target.changes, problems: target.problems });

export function appliedResponse(target: LineupTarget, landed: readonly (LineupMove & { landed: boolean })[], name: (id: number) => string): LineupApplied {
  const byId = new Map(landed.map((m) => [m.playerId, m]));
  const moment = target.lockIn(landed);
  return {
    lockIn: moment && {
      banked: moment.banked,
      before: round(moment.before),
      after: round(moment.after),
      leftover: moment.leftover,
      level: moment.level,
      headline: lockInHeadline(moment.level, moment.banked),
      confetti: moment.confetti,
      moves: [
        ...moment.warRoom.map((m) => ({ playerId: m.playerId, text: `${name(m.playerId)} in at ${label(m.to)}`, gain: m.gain, own: false })),
        ...moment.own.map((m) => ({ playerId: m.playerId, text: `${name(m.playerId)} in at ${label(m.to)}`, gain: m.delta, own: true })),
      ],
    },
    changes: target.changes
      .filter((c) => c.picked)
      .map(({ id, text, moves }) => {
        const out = moves.map((m) => ({ ...m, landed: byId.get(m.playerId)?.landed ?? false }));
        const missed = out.filter((m) => !m.landed);
        const result = !missed.length
          ? "Done on ESPN."
          : missed.length === out.length
            ? "Didn't land on ESPN. Check it there."
            : `Only part of this landed on ESPN: ${missed.map((m) => name(m.playerId)).join(" and ")} didn't move. Check it there.`;
        return { id, text, landed: !missed.length, result, moves: out };
      }),
  };
}
