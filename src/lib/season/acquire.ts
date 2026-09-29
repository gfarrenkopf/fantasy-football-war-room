import type { ApplyEntry } from "./apply";
import type { LineupSlotCount } from "./types";

/**
 * Adding a player from the pool, with a drop to make room (Epic 13, 13.3): a free agent at once, or
 * a waiver claim that processes later (13.4). Pure: the checks the browser runs while the user picks
 * a drop, and the server runs again on a fresh read before it writes (docs/espn-protocol.md §8,
 * "Roster transactions").
 */

export interface Acquire {
  /** The player coming in, from ESPN's pool. */
  add: number;
  /** The user's player going out, or null when the roster has room. */
  drop: number | null;
}

/** `ADD` / `DROP` items of a `FREEAGENT` or `WAIVER` transaction. Team 0 is the pool. */
export type EspnAcquireItem = { playerId: number; type: "ADD"; toTeamId: number } | { playerId: number; type: "DROP"; fromTeamId: number };

/** The most players a team may carry outside IR: every starting slot plus the bench. ESPN enforces it. */
export const rosterLimit = (starters: readonly LineupSlotCount[], benchSize: number) => starters.reduce((n, s) => n + s.count, 0) + benchSize;

/** Players counting against the roster limit: everyone but IR. */
const counted = (roster: readonly Pick<ApplyEntry, "slot">[]) => roster.filter((p) => p.slot !== "IR").length;

/** Whether the roster needs a drop to take one more player. */
export const needsDrop = (roster: readonly Pick<ApplyEntry, "slot">[], limit: number) => counted(roster) + 1 > limit;

/**
 * Why this add can't be sent to ESPN, in words for the user; empty when it can. `teams` is every
 * team's roster, to catch a player someone else has picked up since the pool was read.
 */
export function checkAcquire(roster: readonly ApplyEntry[], teams: readonly { name: string; roster: readonly { playerId: number }[] }[], { add, drop }: Acquire, limit: number): string[] {
  const problems: string[] = [];
  if (roster.some((p) => p.playerId === add)) problems.push("That player is already on your team.");
  else {
    const owner = teams.find((t) => t.roster.some((p) => p.playerId === add));
    if (owner) problems.push(`That player is on ${owner.name} now.`);
  }
  if (drop !== null) {
    const out = roster.find((p) => p.playerId === drop);
    if (!out) problems.push("The player you're dropping isn't on your team any more.");
    else if (out.locked) problems.push(`${out.name}'s game has started, so ESPN won't drop them this week.`);
  }
  if (counted(roster) + 1 - (drop === null ? 0 : 1) > limit) problems.push(`Your roster is full at ${limit} players. Pick someone to drop.`);
  return problems;
}

export function acquireItems(teamId: number, { add, drop }: Acquire): EspnAcquireItem[] {
  return [{ playerId: add, type: "ADD", toTeamId: teamId }, ...(drop === null ? [] : [{ playerId: drop, type: "DROP" as const, fromTeamId: teamId }])];
}

/** What the roster shows after an add: whether the player arrived, and whether the drop left. */
export function acquireLanded(after: readonly { playerId: number }[], { add, drop }: Acquire): { added: boolean; dropped: boolean } {
  const ids = new Set(after.map((p) => p.playerId));
  return { added: ids.has(add), dropped: drop === null || !ids.has(drop) };
}
