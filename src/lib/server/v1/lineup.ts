import type { LineupMove } from "@/lib/season/lineup";
import type { LineupTarget } from "@/lib/season/lineupTarget";

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
}

export const dryRunResponse = (target: LineupTarget): LineupDryRun => ({ changes: target.changes, problems: target.problems });

export function appliedResponse(target: LineupTarget, landed: readonly (LineupMove & { landed: boolean })[], name: (id: number) => string): LineupApplied {
  const byId = new Map(landed.map((m) => [m.playerId, m]));
  return {
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
