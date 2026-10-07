import { describe, expect, it } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { parseResults } from "./espnLeague";
import { leagueRecap } from "./leagueRecap";
import type { MatchupResult } from "./types";
import { standingsAfter, toWeekFacts, WEEK_FACTS_VERSION, type FactPlayer, type WeekFacts } from "./weekFacts";

const p = (playerId: number, slot: FactPlayer["slot"], points: number, projected: number, name = `P${playerId}`): FactPlayer => ({
  playerId,
  name,
  pos: "WR",
  team: "KC",
  slot,
  points,
  projected,
  statLine: null,
});

/** Four teams in week 6; the user is team 1. Team 1 beats 2 by 4.0; team 4 beats 3 by 50. */
function facts(over: Partial<WeekFacts> = {}): WeekFacts {
  return {
    version: WEEK_FACTS_VERSION,
    season: 2026,
    week: 6,
    myTeamId: 1,
    starters: [{ key: "WR", count: 2 }],
    teams: [
      { id: 1, name: "Mine", abbrev: "ME", players: [p(11, "WR", 30, 15, "Puka Nacua"), p(12, "WR", 70, 70), p(13, "BN", 28, 9, "Benched Star")] },
      { id: 2, name: "Rival", abbrev: "RV", players: [p(21, "WR", 2, 15.3, "Dud"), p(22, "WR", 94, 80), p(23, "BN", 0, 8)] },
      { id: 3, name: "Third", abbrev: "TH", players: [p(31, "WR", 50, 60), p(32, "WR", 40, 50)] },
      { id: 4, name: "Fourth", abbrev: "FO", players: [p(41, "WR", 100, 40), p(42, "WR", 40, 45), p(43, "BN", 12, 10)] },
    ],
    matchups: [
      { home: { teamId: 1, points: 100 }, away: { teamId: 2, points: 96 } },
      { home: { teamId: 3, points: 90 }, away: { teamId: 4, points: 140 } },
    ],
    standings: [
      { teamId: 1, rank: 1, wins: 6, losses: 0, ties: 0, pointsFor: 700 },
      { teamId: 4, rank: 2, wins: 4, losses: 2, ties: 0, pointsFor: 650 },
      { teamId: 2, rank: 3, wins: 2, losses: 4, ties: 0, pointsFor: 600 },
      { teamId: 3, rank: 4, wins: 0, losses: 6, ties: 0, pointsFor: 500 },
    ],
    ...over,
  };
}

describe("leagueRecap", () => {
  it("leads with the user's result and their star", () => {
    const { mine } = leagueRecap(facts());
    expect(mine).toMatchObject({ result: "win", me: 100, them: 96, margin: 4, opponent: "Rival", projected: { me: 85, them: 95.3 } });
    expect(mine?.star).toMatchObject({ player: { playerId: 11 }, beat: true });
  });

  it("names the starter whose points over projection outweighed his team's margin", () => {
    const { gameChanger } = leagueRecap(facts());
    // Puka beat ESPN by 15 in a 4-point win; team 4's 60-over star only matters against a 50-point margin.
    expect(gameChanger?.player.playerId).toBe(41);
    expect(gameChanger).toMatchObject({ margin: 50, opponent: "Third", score: { his: 140, theirs: 90 } });
  });

  it("has no game changer when no one's excess decided a matchup", () => {
    const f = facts();
    f.teams[0].players[0] = p(11, "WR", 18, 15);
    f.teams[3].players[0] = p(41, "WR", 60, 40);
    expect(leagueRecap(f).gameChanger).toBeNull();
  });

  it("ranks the top scorers among starters, and the bench and false starters on their own", () => {
    const r = leagueRecap(facts());
    expect(r.topScorers.map((x) => x.playerId)).toEqual([41, 22, 12, 31, 32]);
    expect(r.benchwarmers.map((x) => x.playerId)).toEqual([13, 43]);
    expect(r.falseStarters.map((x) => x.playerId)).toEqual([21, 31, 32]);
    expect(r.falseStarters[0]).toMatchObject({ teamName: "Rival", gap: -13.3 });
  });

  it("copes with an empty bench and a bye", () => {
    const f = facts({ matchups: [{ home: { teamId: 1, points: 100 }, away: null }] });
    f.teams = f.teams.map((t) => ({ ...t, players: t.players.filter((x) => x.slot !== "BN") }));
    const r = leagueRecap(f);
    expect(r.mine).toBeNull();
    expect(r.story).toBe("");
    expect(r.benchwarmers).toEqual([]);
    expect(r.gameChanger).toBeNull();
  });

  it("calls a tie a tie", () => {
    const r = leagueRecap(facts({ matchups: [{ home: { teamId: 1, points: 96 }, away: { teamId: 2, points: 96 } }] }));
    expect(r.mine?.result).toBe("tie");
    expect(r.story).toMatch(/^A dead heat: 96\.0 apiece with Rival\./);
  });

  it("writes the week from what happened", () => {
    expect(leagueRecap(facts()).story).toBe("ESPN had Rival by 10.3. You won anyway, 100.0–96.0. Puka Nacua blew past ESPN's 15.0 with 30.0. That's 6–0, and first in the league.");
    const lost = facts({ matchups: [{ home: { teamId: 1, points: 95 }, away: { teamId: 2, points: 96 } }], standings: [{ teamId: 1, rank: 3, wins: 3, losses: 3, ties: 0, pointsFor: 600 }] });
    expect(leagueRecap(lost).story).toBe("Brutal. Rival got you by 1.0, 96.0–95.0. Puka Nacua blew past ESPN's 15.0 with 30.0. That's 3–3, 3rd in the league.");
  });
});

describe("standingsAfter", () => {
  const results: MatchupResult[] = [
    { weeks: [1], home: { teamId: 1, points: 100 }, away: { teamId: 2, points: 90 }, winner: "home" },
    { weeks: [2], home: { teamId: 2, points: 110 }, away: { teamId: 1, points: 80 }, winner: "home" },
    { weeks: [3], home: { teamId: 1, points: 95 }, away: { teamId: 2, points: 95 }, winner: "tie" },
    { weeks: [4, 5], home: { teamId: 1, points: 200 }, away: { teamId: 2, points: 150 }, winner: "home" },
  ];

  it("counts records through the week asked for, and a two-week period only once both are played", () => {
    expect(standingsAfter(results, 1, [1, 2])).toEqual([
      { teamId: 1, rank: 1, wins: 1, losses: 0, ties: 0, pointsFor: 100 },
      { teamId: 2, rank: 2, wins: 0, losses: 1, ties: 0, pointsFor: 90 },
    ]);
    const third = standingsAfter(results, 4, [1, 2]);
    expect(third.map((r) => [r.teamId, r.wins, r.losses, r.ties])).toEqual([
      [2, 1, 1, 1],
      [1, 1, 1, 1],
    ]);
    expect(standingsAfter(results, 5, [1, 2])[0]).toMatchObject({ teamId: 1, wins: 2 });
  });
});

describe("parseResults", () => {
  it("keeps decided matchups with their period's weeks", () => {
    const raw = {
      settings: { scheduleSettings: { matchupPeriods: { "1": [1], "15": [15, 16] } } },
      schedule: [
        { matchupPeriodId: 15, winner: "AWAY", home: { teamId: 1, totalPoints: 201.44 }, away: { teamId: 2, totalPoints: 230 } },
        { matchupPeriodId: 1, winner: "HOME", home: { teamId: 1, totalPoints: 120 }, away: { teamId: 2, totalPoints: 99 } },
        { matchupPeriodId: 2, winner: "UNDECIDED", home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 } },
      ],
    };
    expect(parseResults(raw)).toEqual([
      { weeks: [1], home: { teamId: 1, points: 120 }, away: { teamId: 2, points: 99 }, winner: "home" },
      { weeks: [15, 16], home: { teamId: 1, points: 201.44 }, away: { teamId: 2, points: 230 }, winner: "away" },
    ]);
  });
});

describe("toWeekFacts", () => {
  it("keeps every team's players in lineup order with points and projections, preferring ESPN's pre-kickoff call", () => {
    const qb = at("QB", player("Kyler Murray", "QB", 18, { playerId: 1, actual: 24.12 }));
    const bench = at("BN", player("Bench Guy", "RB", 9, { playerId: 2, actual: null }));
    const view = {
      ...seasonView([bench, qb], [at("QB", player("Their QB", "QB", 20, { playerId: 9, actual: 11 }))]),
      matchups: [{ home: { teamId: 1, points: 24.12, projected: 24.12, winProbability: null }, away: { teamId: 2, points: 11, projected: 11, winProbability: null } }],
    };
    const f = toWeekFacts(view, new Map([[1, 21.5]]));
    expect(f.week).toBe(5);
    expect(f.teams[0].players.map((x) => [x.playerId, x.slot, x.points, x.projected])).toEqual([
      [1, "QB", 24.12, 21.5],
      [2, "BN", 0, 9],
    ]);
    expect(f.teams[1].players[0].projected).toBe(20);
    expect(f.matchups).toEqual([{ home: { teamId: 1, points: 24.12 }, away: { teamId: 2, points: 11 } }]);
    expect(f.standings.map((s) => s.teamId)).toEqual([1, 2]);
  });
});
