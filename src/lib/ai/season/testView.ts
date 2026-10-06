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
    actual: null,
    statLine: null,
    ownership: null,
    news: null,
    game: null,
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
    irSlots: 1,
    myTeamId: 1,
    teams: [
      { id: 1, name: "Mine", abbrev: "ME", roster: mine, standing: { wins: 3, losses: 1, ties: 0, pointsFor: 480.5, pointsAgainst: 401.2, seed: 2 } },
      { id: 2, name: "Theirs", abbrev: "TH", roster: theirs, standing: { wins: 0, losses: 4, ties: 0, pointsFor: 350, pointsAgainst: 470.8, seed: 10 } },
    ],
    lineup: optimalLineup(mine, STARTERS),
    pendingTrades: [],
    claims: [],
    tradeDeadline: null,
    tradeDeadlinePassed: false,
    matchup: null,
    waiver: { rank: null, budget: null, left: null },
  };
}
