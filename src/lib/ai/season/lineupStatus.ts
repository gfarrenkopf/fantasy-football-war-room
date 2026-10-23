import { isRuledOut, type LineupPlan } from "@/lib/season/lineup";
import type { LineupSlot } from "@/lib/season/types";
import { likelyOut, type ViewPlayer } from "@/lib/season/view";
import { CLOSE_POINTS, type AiLineup } from "./lineup";

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

type Scored = Pick<ViewPlayer, "playerId" | "injuryStatus" | "projected" | "points" | "team" | "game">;

/**
 * Whether the projections have moved under a stored AI lineup since it was written (APE-439), so
 * its lineup no longer holds and it should be written again: one of the AI's starters has left the
 * roster, is ruled out, or ESPN now projects him for nothing, and the engine doesn't start him now
 * either (with nobody better, a rewrite would start him again); or the lineup the engine picked then
 * now projects more than a close call behind the one it picks now.
 */
export function aiLineupOutdated(lineup: AiLineup, plan: Pick<LineupPlan, "starters" | "total">, roster: readonly Scored[]): boolean {
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const starting = new Set(plan.starters.map((s) => s.playerId));
  const gone = lineup.slots.some((s) => {
    if (s.playerId === null || starting.has(s.playerId)) return false;
    const p = byId.get(s.playerId);
    return !p || isRuledOut(p.injuryStatus) || likelyOut(p);
  });
  if (gone) return true;
  const engineThen = lineup.slots.reduce((sum, s) => sum + (s.enginePlayerId === null ? 0 : (byId.get(s.enginePlayerId)?.points ?? 0)), 0);
  return plan.total - engineThen > CLOSE_POINTS;
}
