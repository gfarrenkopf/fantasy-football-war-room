import { alignSeats, changeKey, changeText, checkMoves, groupMoves, movesToStaged, seatsFromRoster, starterSeats, suggestedMoves, type SuggestedMove } from "./apply";
import type { LineupMove } from "./lineup";
import { lockInOf, type LockIn } from "./lockIn";
import type { SeasonView } from "./view";

/**
 * The lineup the iPhone app wants on ESPN, turned into moves (APE-381). The web builds its moves in
 * the browser (useLineupDraft.ts); the app sends the lineup it wants instead, and the server works the
 * moves out here with the same helpers. Pure. IR is left alone unless the app says who should be on
 * it (APE-386), as the web's IR picker does.
 */

/** One change the user sees and can leave out: a group from `groupMoves()`. */
export interface TargetChange {
  /** Stays the same while the lineup around the change does: `changeKey()`. */
  id: string;
  /** In plain words: "Start Jaylen Waddle at WR, bench Tee Higgins". */
  text: string;
  moves: LineupMove[];
  /** Whether it's among the changes to make. */
  picked: boolean;
}

export interface LineupTarget {
  changes: TargetChange[];
  /** The moves of the picked changes. */
  moves: LineupMove[];
  /** The picked moves War Room suggested, with what each gains (APE-256). */
  suggested: SuggestedMove[];
  /** Why the picked changes can't go to ESPN, in words for the user; empty when they can. */
  problems: string[];
  /** The Lock In moment (APE-294) for what landed, once ESPN took the picked moves; null when it doesn't play. */
  lockIn: (landed: readonly (LineupMove & { landed: boolean })[]) => LockIn | null;
}

/**
 * The moves that set `lineup` on ESPN. `lineup` names who sits in each seat of the season response's
 * `lineup.seats`, or null to leave it empty; anyone not named goes to the bench. `ir` names everyone
 * who should be on IR, as `movesToStaged()` takes it; left out, IR stays as it is. `picked` lists the
 * ids of the changes to make, all of them when left out. Null when the request doesn't fit the view:
 * the wrong number of seats, or a change id that isn't one of this lineup's.
 */
export function lineupTarget(view: SeasonView, lineup: readonly (number | null)[], picked?: readonly string[], ir?: readonly number[]): LineupTarget | null {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const seats = starterSeats(view.starters);
  if (lineup.length !== seats.length) return null;
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const name = (id: number) => byId.get(id)?.name ?? `Player ${id}`;

  const problems: string[] = [];
  const named = lineup.filter((id): id is number => id !== null);
  for (const id of new Set(named)) {
    const p = byId.get(id);
    if (!p) problems.push(`Player ${id} isn't on your team.`);
    else if (ir ? ir.includes(id) : p.slot === "IR") problems.push(`${p.name} is on IR. Take them off IR before starting them.`);
    else if (named.indexOf(id) !== named.lastIndexOf(id)) problems.push(`${p.name} is in two slots.`);
  }
  for (const id of new Set(ir ?? [])) if (!byId.has(id)) problems.push(`Player ${id} isn't on your team.`);
  if (problems.length) return { changes: [], moves: [], suggested: [], problems, lockIn: () => null };

  const onEspn = seatsFromRoster(roster, seats);
  const staged = alignSeats(seats, onEspn, lineup);
  const groups = groupMoves(movesToStaged(roster, seats, staged, ir && [...new Set(ir)]), onEspn, staged);
  const ids = groups.map(changeKey);
  if (picked?.some((id) => !ids.includes(id))) return null;
  const changes = groups.map((moves, i) => ({ id: ids[i], text: changeText(moves, name), moves, picked: !picked || picked.includes(ids[i]) }));
  const moves = changes.flatMap((c) => (c.picked ? c.moves : []));
  const recommended = alignSeats(seats, onEspn, view.lineup.starters.map((f) => f.playerId));
  const points = (id: number | null) => (id === null ? 0 : (byId.get(id)?.points ?? 0));
  const suggested = suggestedMoves(moves, seats, staged, recommended, onEspn, points);
  return {
    changes,
    moves,
    suggested,
    problems: moves.length ? checkMoves(roster, moves, view.starters, view.benchSize, view.irSlots) : [],
    lockIn: (landed) => lockInOf(landed, { seats, staged, onEspn, recommended, sent: moves, suggested, points }),
  };
}
