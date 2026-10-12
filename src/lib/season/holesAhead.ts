import { rosterLimit } from "./acquire";
import { canPlay } from "./apply";
import { pickDrops } from "./drops";
import type { PoolPlayer } from "./holes";
import { optimalLineup } from "./lineup";
import type { LineupSlotCount } from "./types";
import type { SeasonView } from "./view";

/**
 * Holes in the weeks ahead (APE-353): a starting slot the roster can't fill with anyone ESPN projects
 * to score that week. Byes are known all season, so next week's are worth a waiver claim now, while
 * claims can still clear. A slot that's a hole week after week is thin, and a trade is the fix.
 *
 * Only projections are known ahead, so a player counts if ESPN projects him for that week: a bye
 * projects 0, and so does a player out for longer. Injuries this week are this week's (holes.ts).
 */

type StarterKey = LineupSlotCount["key"];

export interface WeekHole {
  week: number;
  key: StarterKey;
  /** Who'd sit in the slot that week anyway, projecting 0; null when nobody can play it at all. */
  playerId: number | null;
  /** out: on IR or suspended now. zero: ESPN projects him for nothing that week, most often a bye. */
  reason: "out" | "zero" | "empty";
}

const LONG_OUT = new Set(["INJURY_RESERVE", "SUSPENSION"]);

/** The holes in `week`'s best lineup, by ESPN's projections for that week. */
export function holesInWeek(view: SeasonView, week: number): WeekHole[] {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const candidates = roster.map((p) => ({ playerId: p.playerId, pos: p.pos, slot: "BN" as const, locked: false, injuryStatus: "ACTIVE", points: p.weekly[week] ?? 0 }));
  return optimalLineup(candidates, view.starters).starters.flatMap((fill): WeekHole[] => {
    if (fill.playerId !== null && fill.points > 0) return [];
    const p = fill.playerId === null ? undefined : byId.get(fill.playerId);
    return [{ week, key: fill.key, playerId: p?.playerId ?? null, reason: !p ? "empty" : LONG_OUT.has(p.injuryStatus) ? "out" : "zero" }];
  });
}

/** Next week's holes; empty in the league's last week. */
export const nextWeekHoles = (view: SeasonView) => (view.currentWeek < view.finalWeek ? holesInWeek(view, view.currentWeek + 1) : []);

/** A slot that's a hole in more than one week left, or held by a player out long-term: a trade's job. */
export interface ThinSlot {
  key: StarterKey;
  /** The weeks after this one it's a hole. */
  weeks: number[];
  /** How many weeks are left after this one. */
  of: number;
}

export function thinSlots(view: SeasonView): ThinSlot[] {
  const weeks = Array.from({ length: Math.max(0, view.finalWeek - view.currentWeek) }, (_, i) => view.currentWeek + 1 + i);
  const holes = weeks.flatMap((w) => holesInWeek(view, w));
  const keys = [...new Set(holes.map((h) => h.key))];
  return keys.flatMap((key): ThinSlot[] => {
    const at = holes.filter((h) => h.key === key);
    const hit = [...new Set(at.map((h) => h.week))];
    return hit.length > 1 || at.some((h) => h.reason === "out") ? [{ key, weeks: hit, of: weeks.length }] : [];
  });
}

export interface AheadFill {
  player: PoolPlayer;
  /** Who to drop to make room; null when there's room. */
  drop: number | null;
}

/**
 * The best pickups for each of next week's holes: eligible, projected for that week, most points
 * first. Drops come from the shared rule (drops.ts), never a player who starts that week. Two holes
 * never share a pickup.
 */
export function rankAhead(view: SeasonView, holes: readonly WeekHole[], pool: readonly PoolPlayer[], limit = 2): { hole: WeekHole; fills: AheadFill[] }[] {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const counted = roster.filter((p) => p.slot !== "IR");
  const full = counted.length + 1 > rosterLimit(view.starters, view.benchSize);
  const taken = new Set<number>();
  return holes.map((hole) => {
    const week = (p: PoolPlayer) => p.weekly[hole.week] ?? 0;
    const starting = new Set(
      optimalLineup(
        counted.map((p) => ({ playerId: p.playerId, pos: p.pos, slot: "BN" as const, locked: false, injuryStatus: "ACTIVE", points: p.weekly[hole.week] ?? 0 })),
        view.starters,
      ).starters.flatMap((s) => (s.playerId !== null && s.points > 0 ? [s.playerId] : [])),
    );
    const fills = pool
      .filter((p) => !taken.has(p.playerId) && canPlay(p.pos, hole.key) && week(p) > 0)
      .sort((a, b) => week(b) - week(a) || b.ros - a.ros || a.playerId - b.playerId)
      .slice(0, limit)
      .map((p): AheadFill => ({ player: p, drop: full ? (pickDrops([...counted, p], 1, view, { keep: new Set([...starting, p.playerId]) })[0] ?? null) : null }));
    if (fills[0]) taken.add(fills[0].player.playerId);
    return { hole, fills };
  });
}
