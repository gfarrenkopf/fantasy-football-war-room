import type { Position } from "@/lib/draft/types";
import type { ProjectionAccuracy } from "./accuracy";
import { compareLineups } from "./lineup";
import type { LineupSlotCount } from "./types";
import type { SeasonView } from "./view";

/**
 * The week told as a result (APE-230): the final score, the margin, the user's starters as they
 * scored, and the star of the week. Pure, so the win show and the win card tell it the same way.
 */

export interface RecapStarter {
  slot: LineupSlotCount["key"];
  playerId: number;
  name: string;
  pos: Position;
  team: string | null;
  points: number;
  /** ESPN's call before kickoff when it was recorded, otherwise the projection on the page. */
  projected: number;
}

export interface WeekRecap {
  week: number;
  result: "win" | "loss" | "tie";
  me: number;
  them: number;
  margin: number;
  opponent: string;
  starters: RecapStarter[];
  /** The starter who most beat his projection; failing that, the top scorer. Null with no starter scored. */
  star: { player: RecapStarter; beat: boolean } | null;
}

export function weekRecap(view: SeasonView, accuracy: ProjectionAccuracy | null): WeekRecap | null {
  if (!view.matchup) return null;
  const { me, them } = view.matchup;
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const called = new Map((accuracy?.players ?? []).map((p) => [p.playerId, p.projected]));
  const starters = compareLineups(roster, view.lineup).flatMap((row): RecapStarter[] => {
    const p = row.now === null ? undefined : byId.get(row.now);
    if (!p) return [];
    return [{ slot: row.key, playerId: p.playerId, name: p.name, pos: p.pos, team: p.team, points: p.actual ?? 0, projected: called.get(p.playerId) ?? p.points }];
  });
  const scored = starters.filter((p) => p.points !== 0 || byId.get(p.playerId)?.actual !== null);
  const beat = [...scored].sort((a, b) => b.points - b.projected - (a.points - a.projected))[0];
  const top = [...scored].sort((a, b) => b.points - a.points)[0];
  const star = beat && beat.points > beat.projected ? { player: beat, beat: true } : top ? { player: top, beat: false } : null;
  return {
    week: view.currentWeek,
    result: me.points > them.points ? "win" : me.points < them.points ? "loss" : "tie",
    me: me.points,
    them: them.points,
    margin: Math.round(Math.abs(me.points - them.points) * 10) / 10,
    opponent: view.teams.find((t) => t.id === them.teamId)?.name ?? "Your opponent",
    starters,
    star,
  };
}
