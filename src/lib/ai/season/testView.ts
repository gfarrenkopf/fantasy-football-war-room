import type { Position } from "@/lib/draft/types";
import { optimalLineup } from "@/lib/season/lineup";
import type { LineupSlot, LineupSlotCount } from "@/lib/season/types";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";

/** Small season views for the in-season AI tests. For tests only. */

export const STARTERS: LineupSlotCount[] = [
  { key: "QB", count: 1 },
  { key: "RB", count: 2 },
  { key: "WR", count: 2 },
  { key: "TE", count: 1 },
  { key: "FLEX", count: 1 },
];

let nextId = 100;

/** A player projecting `pts` in each of weeks 5–7 (or per week, given an array). */
export function player(name: string, pos: Position, pts: number | number[], over: Partial<ViewPlayer> = {}): ViewPlayer {
  const byWeek = Array.isArray(pts) ? pts : [pts, pts, pts];
  return {
    playerId: ++nextId,
    name,
    pos,
    team: "DET",
    slot: "BN",
    espnSlotId: 20,
    locked: false,
    injuryStatus: "ACTIVE",
    weekly: { 5: byWeek[0], 6: byWeek[1], 7: byWeek[2] },
    points: byWeek[0],
    ros: byWeek.reduce((a, b) => a + b, 0),
    projected: true,
    ...over,
  };
}

export const at = (slot: LineupSlot, p: ViewPlayer): ViewPlayer => ({ ...p, slot });

/** A two-team league in week 5 of 7, playoffs from week 7. Team 1 is the user's. */
export function seasonView(mine: ViewPlayer[], theirs: ViewPlayer[] = []): SeasonView {
  return {
    name: "Test league",
    espnLeagueId: "1",
    season: 2026,
    currentWeek: 5,
    finalWeek: 7,
    playoffStartWeek: 7,
    starters: STARTERS,
    benchSize: 3,
    myTeamId: 1,
    teams: [
      { id: 1, name: "Mine", abbrev: "ME", roster: mine },
      { id: 2, name: "Theirs", abbrev: "TH", roster: theirs },
    ],
    lineup: optimalLineup(mine, STARTERS),
    pendingTrades: [],
  };
}
