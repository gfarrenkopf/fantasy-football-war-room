import { totalPicks } from "./snake";
import type { Dataset, LeagueSettings, Position, RosterSlot, RosterSlotKey } from "./types";

/** Slot keys in display order, with the positions each accepts. */
export const SLOT_DEFS: { key: RosterSlotKey; label: string; eligible: Position[] }[] = [
  { key: "QB", label: "QB", eligible: ["QB"] },
  { key: "RB", label: "RB", eligible: ["RB"] },
  { key: "WR", label: "WR", eligible: ["WR"] },
  { key: "TE", label: "TE", eligible: ["TE"] },
  { key: "FLEX", label: "FLEX (RB/WR/TE)", eligible: ["RB", "WR", "TE"] },
  { key: "SUPERFLEX", label: "SUPERFLEX (QB/RB/WR/TE)", eligible: ["QB", "RB", "WR", "TE"] },
  { key: "DST", label: "D/ST", eligible: ["DST"] },
  { key: "K", label: "K", eligible: ["K"] },
  { key: "BN", label: "Bench", eligible: [] },
];

export type SlotCounts = Record<RosterSlotKey, number>;

/** How many of each slot a roster has. */
export function slotCounts(roster: RosterSlot[]): SlotCounts {
  const counts = Object.fromEntries(SLOT_DEFS.map((d) => [d.key, 0])) as SlotCounts;
  for (const s of roster) counts[s.key]++;
  return counts;
}

/** Builds a roster in canonical display order (starters by position, flex, K/DST, bench). */
export function rosterFromCounts(counts: Partial<SlotCounts>): RosterSlot[] {
  return SLOT_DEFS.flatMap((d) => Array.from({ length: Math.max(0, counts[d.key] ?? 0) }, () => ({ key: d.key, eligible: [...d.eligible] })));
}

export const MIN_TEAMS = 4;
export const MAX_TEAMS = 20;
/** Keep this many players in the pool beyond the last pick, so the draft doesn't end on leftover kickers. */
export const SPARE_PLAYERS = 10;

/** Problems that make a league unusable with this dataset, as user-facing messages. Empty when valid. */
export function validateLeague(league: LeagueSettings, dataset: Pick<Dataset, "players" | "scoring">): string[] {
  const errors: string[] = [];
  const counts = slotCounts(league.roster);
  if (!Number.isInteger(league.teams) || league.teams < MIN_TEAMS || league.teams > MAX_TEAMS) {
    errors.push(`Teams must be between ${MIN_TEAMS} and ${MAX_TEAMS}.`);
  }
  if (!Number.isInteger(league.mySlot) || league.mySlot < 1 || league.mySlot > league.teams) {
    errors.push(`Your draft slot must be between 1 and ${league.teams}.`);
  }
  if (!dataset.scoring.includes(league.scoring)) {
    errors.push("The loaded player data doesn't have rankings for this scoring format.");
  }
  if (league.roster.length - counts.BN < 1) errors.push("Add at least one starting slot.");
  const available = dataset.players.length - SPARE_PLAYERS;
  if (totalPicks(league) > available) {
    errors.push(
      `${league.teams} teams × ${league.roster.length} rounds is ${totalPicks(league)} picks, but the player data only supports ${available}. Shrink the bench or the league.`,
    );
  }
  if (!(league.valueThreshold >= 1 && league.valueThreshold <= 50)) errors.push("Value/Reach threshold must be between 1 and 50.");
  return errors;
}

/** True when two leagues would produce different drafts (so existing picks no longer fit). */
export function leagueChanged(a: LeagueSettings, b: LeagueSettings): boolean {
  const shape = (l: LeagueSettings) => JSON.stringify([l.teams, l.mySlot, l.scoring, l.roster.map((s) => s.key)]);
  return shape(a) !== shape(b);
}

/** Validates a stored league; returns null if it's missing fields or malformed. */
export function parseStoredLeague(raw: unknown): LeagueSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const l = raw as Partial<LeagueSettings>;
  const keys = new Set(SLOT_DEFS.map((d) => d.key));
  if (
    typeof l.teams !== "number" ||
    typeof l.mySlot !== "number" ||
    typeof l.valueThreshold !== "number" ||
    !["ppr", "half", "std"].includes(l.scoring as string) ||
    !Array.isArray(l.roster) ||
    !l.roster.every((s) => s && keys.has(s.key))
  ) {
    return null;
  }
  // Rebuild slots from their keys so eligibility always matches SLOT_DEFS.
  return { teams: l.teams, mySlot: l.mySlot, scoring: l.scoring!, valueThreshold: l.valueThreshold, roster: rosterFromCounts(slotCounts(l.roster)) };
}
