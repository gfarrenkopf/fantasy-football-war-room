import { describe, expect, it } from "vitest";
import { dataset, LEAGUE_PRESETS, standardRoster } from "@/lib/data";
import { slotOf, totalPicks } from "../snake";
import type { CpuStyle, DraftPick, LeagueSettings, Position } from "../types";
import { createSimContext, positionRules } from "./context";
import { mulberry32 } from "./rng";
import { simulateFrom, slotForRoomIndex, roomIndex } from "./simulate";
import { CPU_STYLES, defaultRoom, roomFor } from "./styles";

const leagueOf = (teams: number, mySlot = 1): LeagueSettings => ({ ...LEAGUE_PRESETS.find((p) => p.league.teams === teams)!.league, mySlot });

function rosters(picks: DraftPick[], teams: number) {
  const byId = new Map(dataset.players.map((p) => [p.id, p]));
  const out = Array.from({ length: teams + 1 }, () => ({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 }) as Record<Position, number>);
  picks.forEach((pick, i) => out[slotOf(i + 1, teams)][byId.get(pick.playerId)!.pos]++);
  return out.slice(1);
}

describe("positionRules for the standard roster", () => {
  it("match the prototype's hardcoded limits", () => {
    const r = positionRules({ roster: standardRoster() });
    expect(r.QB).toEqual({ need: 1, soft: 1, cap: 2 });
    expect(r.TE).toEqual({ need: 1, soft: 1, cap: 2 });
    expect(r.K).toEqual({ need: 1, soft: 1, cap: 1 });
    expect(r.DST).toEqual({ need: 1, soft: 1, cap: 1 });
    expect(r.RB).toEqual({ need: 2, soft: 6, cap: 8 });
    expect(r.WR).toEqual({ need: 2, soft: 6, cap: 8 });
  });

  it("count SUPERFLEX as a QB need", () => {
    const roster = [...standardRoster(), { key: "SUPERFLEX" as const, eligible: ["QB", "RB", "WR", "TE"] as Position[] }];
    expect(positionRules({ roster }).QB).toEqual({ need: 2, soft: 2, cap: 3 });
  });
});

describe("simulateFrom: full mock drafts", () => {
  for (const teams of [10, 12, 14]) {
    it(`${teams} teams × 50 seeds: always completes with valid rosters`, () => {
      const league = leagueOf(teams);
      const ctx = createSimContext(league, dataset.players);
      const caps = positionRules(league);
      for (let seed = 1; seed <= 50; seed++) {
        const picks = simulateFrom([], defaultRoom(teams), ctx, { autoMe: true, rng: mulberry32(seed) });
        expect(picks).toHaveLength(totalPicks(league));
        expect(new Set(picks.map((p) => p.playerId)).size).toBe(picks.length);
        for (const team of rosters(picks, teams)) {
          for (const pos of Object.keys(team) as Position[]) expect(team[pos], `${pos} seed ${seed}`).toBeLessThanOrEqual(caps[pos].cap);
          expect(team.K).toBeLessThanOrEqual(1);
          expect(team.DST).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  it("every style can fill a whole room without breaking the rules", () => {
    const league = leagueOf(12);
    const ctx = createSimContext(league, dataset.players);
    for (const style of CPU_STYLES) {
      const room = Array.from({ length: 11 }, () => style as CpuStyle);
      const picks = simulateFrom([], room, ctx, { autoMe: true, rng: mulberry32(7) });
      expect(picks).toHaveLength(192);
      for (const team of rosters(picks, 12)) {
        expect(team.K).toBeLessThanOrEqual(1);
        expect(team.DST).toBeLessThanOrEqual(1);
        expect(team.QB).toBeLessThanOrEqual(2);
        expect(team.TE).toBeLessThanOrEqual(2);
      }
    }
  });

  it("drafts a starting QB, TE, K and D/ST for nearly every team (12 teams)", () => {
    const ctx = createSimContext(leagueOf(12), dataset.players);
    let teams = 0;
    let complete = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (const t of rosters(simulateFrom([], defaultRoom(12), ctx, { autoMe: true, rng: mulberry32(seed) }), 12)) {
        teams++;
        if (t.QB >= 1 && t.TE >= 1 && t.K === 1 && t.DST === 1 && t.RB >= 2 && t.WR >= 2) complete++;
      }
    }
    expect(complete / teams).toBeGreaterThanOrEqual(0.95);
  });

  it("is reproducible with the same seed and differs across seeds", () => {
    const ctx = createSimContext(leagueOf(12), dataset.players);
    const run = (seed: number) => simulateFrom([], defaultRoom(12), ctx, { autoMe: true, rng: mulberry32(seed) });
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("continues from existing picks without changing them", () => {
    const ctx = createSimContext(leagueOf(12), dataset.players);
    const existing: DraftPick[] = [
      { playerId: "jahmyr-gibbs-rb-det", mine: true },
      { playerId: "puka-nacua-wr-lar", mine: false },
    ];
    const picks = simulateFrom(existing, defaultRoom(12), ctx, { autoMe: true, rng: mulberry32(1) });
    expect(picks.slice(0, 2)).toEqual(existing);
    expect(picks).toHaveLength(192);
  });

  it("stops at the user's next pick when autoMe is false", () => {
    const league = leagueOf(12, 5);
    const ctx = createSimContext(league, dataset.players);
    const toMe = simulateFrom([], defaultRoom(12), ctx, { autoMe: false, rng: mulberry32(1) });
    expect(toMe).toHaveLength(4);
    expect(toMe.every((p) => !p.mine)).toBe(true);
    // Already on the clock: nothing to simulate.
    expect(simulateFrom(toMe, defaultRoom(12), ctx, { autoMe: false, rng: mulberry32(1) })).toEqual(toMe);
  });

  it("marks exactly the user's slot as mine, for a middle draft slot", () => {
    const league = leagueOf(10, 7);
    const ctx = createSimContext(league, dataset.players);
    const picks = simulateFrom([], defaultRoom(10), ctx, { autoMe: true, rng: mulberry32(3) });
    picks.forEach((p, i) => expect(p.mine).toBe(slotOf(i + 1, 10) === 7));
  });
});

describe("rooms", () => {
  it("defaultRoom cycles the prototype's 11-team room to any league size", () => {
    expect(defaultRoom(12)).toEqual(["casual", "sharp", "qbEarly", "casual", "zeroRB", "rbHeavy", "casual", "teReach", "homer", "casual", "chaos"]);
    expect(defaultRoom(10)).toHaveLength(9);
    expect(defaultRoom(14)).toHaveLength(13);
    expect(defaultRoom(14).slice(11)).toEqual(["casual", "sharp"]);
  });

  it("roomFor falls back to the default when a saved room doesn't fit", () => {
    expect(roomFor(["sharp", "sharp"], 3)).toEqual(["sharp", "sharp"]);
    expect(roomFor(["sharp"], 12)).toEqual(defaultRoom(12));
    expect(roomFor(null, 10)).toEqual(defaultRoom(10));
  });

  it("roomIndex and slotForRoomIndex are inverses around the user's slot", () => {
    for (const mySlot of [1, 6, 12]) {
      const slots = Array.from({ length: 11 }, (_, i) => slotForRoomIndex(i, mySlot));
      expect(slots).not.toContain(mySlot);
      slots.forEach((slot, i) => expect(roomIndex(slot, mySlot)).toBe(i));
    }
  });
});
