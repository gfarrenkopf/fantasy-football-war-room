import type { LineupSlot } from "@/lib/season/types";
import type { AiLineup } from "./lineup";

/**
 * A stored AI lineup against the lineup on ESPN now (12.1). The AI lineup is written once and kept,
 * but the user can change their ESPN lineup afterwards, from War Room or on ESPN; this says whether
 * they have, and which of the AI's starters ESPN doesn't start yet. Pure, so the page runs it live.
 */

/** Who starts on ESPN: everyone off the bench and IR, sorted by player id. */
export const espnStartersOf = (roster: readonly { playerId: number; slot: LineupSlot }[]): number[] =>
  roster
    .filter((p) => p.slot !== "BN" && p.slot !== "IR")
    .map((p) => p.playerId)
    .sort((a, b) => a - b);

export interface AiLineupStatus {
  /** ESPN's starters changed since the AI lineup was written; null when that wasn't recorded. */
  changedSince: boolean | null;
  /** The AI's starters that ESPN doesn't start now, by slot. Empty when ESPN has the AI's lineup. */
  missing: { key: AiLineup["slots"][number]["key"]; playerId: number }[];
}

export function aiLineupStatus(lineup: AiLineup, roster: readonly { playerId: number; slot: LineupSlot }[]): AiLineupStatus {
  const now = espnStartersOf(roster);
  const starting = new Set(now);
  return {
    changedSince: lineup.espnStarters ? lineup.espnStarters.join(",") !== now.join(",") : null,
    missing: lineup.slots.flatMap((s) => (s.playerId !== null && !starting.has(s.playerId) ? [{ key: s.key, playerId: s.playerId }] : [])),
  };
}
