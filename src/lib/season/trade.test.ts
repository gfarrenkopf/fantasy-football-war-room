import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/draft/types";
import { evaluateTrade, type TradeLeague, type TradeTeam } from "./trade";
import type { ViewPlayer } from "./view";

/** Weeks 3–5: three weeks left. */
const LEAGUE: TradeLeague = {
  starters: [
    { key: "QB", count: 1 },
    { key: "RB", count: 2 },
    { key: "WR", count: 2 },
    { key: "TE", count: 1 },
    { key: "FLEX", count: 1 },
  ],
  benchSize: 2,
  currentWeek: 3,
  finalWeek: 5,
};

let nextId = 0;
/** A player projecting `pts` every week, or per week when given an array for weeks 3–5. */
function p(pos: Position, pts: number | number[]): ViewPlayer {
  const byWeek = Array.isArray(pts) ? pts : [pts, pts, pts];
  const weekly = { 3: byWeek[0], 4: byWeek[1], 5: byWeek[2] };
  return {
    playerId: ++nextId,
    name: `${pos}${nextId}`,
    pos,
    team: "DET",
    slot: "BN",
    espnSlotId: 20,
    locked: false,
    injuryStatus: "ACTIVE",
    weekly,
    points: byWeek[0],
    ros: byWeek.reduce((a, b) => a + b, 0),
    projected: true,
  };
}

/** A team and its roster. */
function team(id: number, players: ViewPlayer[]): TradeTeam {
  return { id, roster: players };
}

describe("evaluateTrade", () => {
  it("scores a 1-for-1 by what it does to each starting lineup", () => {
    const aRb = p("RB", 10);
    const bWr = p("WR", 12);
    const a = team(1, [p("QB", 20), p("RB", 15), p("RB", 14), aRb, p("WR", 13), p("WR", 11), p("WR", 5), p("TE", 8), p("TE", 2)]);
    const b = team(2, [p("QB", 18), p("RB", 9), p("RB", 8), p("RB", 3), p("WR", 16), bWr, p("WR", 12), p("TE", 7), p("QB", 5)]);
    const v = evaluateTrade([a, b], LEAGUE, { teamA: 1, gives: [aRb.playerId], teamB: 2, gets: [bWr.playerId] })!;
    // A: WRs 13 + 11 and FLEX RB 10 become WRs 13 + 12 and FLEX WR 11: +2/week.
    expect(v.a.perWeek).toBeCloseTo(2);
    expect(v.a.delta).toBeCloseTo(6);
    // B: RBs 9 + 8 and FLEX WR 12 become RBs 10 + 9 and FLEX RB 8: -2/week.
    expect(v.b.perWeek).toBeCloseTo(-2);
    expect(v.weeks).toBe(3);
    expect(v.a.drops).toEqual([]);
  });

  it("credits a 2-for-1 consolidation to the team getting the best player, and cuts the other roster to fit", () => {
    const stud = p("WR", 22);
    const two = [p("WR", 9), p("WR", 8.5)];
    const a = team(1, [p("QB", 20), p("RB", 15), p("RB", 14), p("RB", 6), ...two, p("WR", 10), p("TE", 8), p("TE", 1)]);
    const b = team(2, [p("QB", 18), p("RB", 12), p("RB", 11), p("RB", 4), stud, p("WR", 13), p("WR", 7), p("TE", 9), p("K", 0)]);
    const v = evaluateTrade([a, b], LEAGUE, { teamA: 1, gives: two.map((x) => x.playerId), teamB: 2, gets: [stud.playerId] })!;
    // A: WRs were 10, 9 with FLEX WR 8.5; now 22, 10 with FLEX RB 6. (22 + 10 + 6) - (10 + 9 + 8.5) = 10.5/week.
    expect(v.a.perWeek).toBeCloseTo(10.5);
    // B loses its best WR and takes two lesser ones: WRs 13, 9, FLEX 8.5 against 22, 13, FLEX 7.
    expect(v.b.perWeek).toBeCloseTo(13 + 9 + 8.5 - (22 + 13 + 7));
    // B now has ten players for nine spots: the K projecting nothing goes.
    expect(v.b.drops).toEqual([b.roster[8].playerId]);
    expect(v.a.drops).toEqual([]);
  });

  it("shows a trade that empties a starting slot as the hole it is", () => {
    const onlyTe = p("TE", 11);
    const rb = p("RB", 11);
    const a = team(1, [p("QB", 20), p("RB", 15), p("RB", 14), p("WR", 13), p("WR", 12), p("WR", 4), onlyTe]);
    const b = team(2, [p("QB", 18), p("RB", 12), rb, p("RB", 9), p("WR", 13), p("WR", 7), p("TE", 9)]);
    const v = evaluateTrade([a, b], LEAGUE, { teamA: 1, gives: [onlyTe.playerId], teamB: 2, gets: [rb.playerId] })!;
    const te = v.a.bySlot.find((s) => s.key === "TE")!;
    expect(te).toEqual({ key: "TE", before: 11, after: 0 });
    // A gains FLEX 11 over WR 4 (+7) but loses 11 at TE: -4/week.
    expect(v.a.perWeek).toBeCloseTo(-4);
  });

  it("counts byes: a player off in a remaining week is worth that much less", () => {
    const byeRb = p("RB", [12, 0, 12]);
    const steadyRb = p("RB", 10);
    const base = () => [p("QB", 20), p("WR", 13), p("WR", 12), p("TE", 8)];
    const a = team(1, [...base(), p("RB", 15), byeRb, p("RB", 1)]);
    const b = team(2, [...base(), p("RB", 15), steadyRb, p("RB", 1)]);
    const v = evaluateTrade([a, b], LEAGUE, { teamA: 1, gives: [byeRb.playerId], teamB: 2, gets: [steadyRb.playerId] })!;
    // Seven players for seven slots, so everyone starts: 12 + 0 + 12 = 24 becomes 10 a week = 30.
    expect(v.a.delta).toBeCloseTo(6);
    expect(v.b.delta).toBeCloseTo(-6);
  });

  it("refuses a trade that isn't one", () => {
    const a = team(1, [p("QB", 1)]);
    const b = team(2, [p("QB", 1)]);
    expect(evaluateTrade([a, b], LEAGUE, { teamA: 1, gives: [], teamB: 2, gets: [] })).toBeNull();
    expect(evaluateTrade([a, b], LEAGUE, { teamA: 1, gives: [a.roster[0].playerId], teamB: 1, gets: [] })).toBeNull();
    expect(evaluateTrade([a, b], LEAGUE, { teamA: 1, gives: [b.roster[0].playerId], teamB: 2, gets: [] })).toBeNull();
  });
});
