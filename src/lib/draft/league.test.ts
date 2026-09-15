import { describe, expect, it } from "vitest";
import { dataset, DEFAULT_LEAGUE, standardRoster } from "@/lib/data";
import { leagueChanged, parseStoredLeague, rosterFromCounts, slotCounts, validateLeague } from "./league";
import { buildRoster, conflicts } from "./roster";
import { slotOf, totalPicks } from "./snake";
import { createSimContext, defaultRoom, mulberry32, positionRules, simulateFrom } from "./sim";
import type { LeagueSettings, Position } from "./types";

const tenTeamSlot7: LeagueSettings = { ...DEFAULT_LEAGUE, teams: 10, mySlot: 7 };
const fourteenSuperflex: LeagueSettings = {
  ...DEFAULT_LEAGUE,
  teams: 14,
  mySlot: 3,
  roster: rosterFromCounts({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, DST: 1, K: 1, BN: 5 }),
};

describe("roster counts", () => {
  it("round-trip the standard roster in display order", () => {
    const counts = slotCounts(standardRoster());
    expect(counts).toMatchObject({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, DST: 1, K: 1, BN: 7 });
    expect(rosterFromCounts(counts)).toEqual(standardRoster());
  });
});

describe("validateLeague", () => {
  it("accepts the presets and the acceptance leagues", () => {
    expect(validateLeague(DEFAULT_LEAGUE, dataset)).toEqual([]);
    expect(validateLeague(tenTeamSlot7, dataset)).toEqual([]);
    expect(validateLeague(fourteenSuperflex, dataset)).toEqual([]);
  });

  it("explains what's wrong", () => {
    expect(validateLeague({ ...DEFAULT_LEAGUE, mySlot: 13 }, dataset)[0]).toMatch(/slot must be between 1 and 12/);
    expect(validateLeague({ ...DEFAULT_LEAGUE, teams: 2, mySlot: 1 }, dataset)[0]).toMatch(/Teams must be between/);
    expect(validateLeague({ ...DEFAULT_LEAGUE, scoring: "half" }, dataset)[0]).toMatch(/scoring format/);
    expect(validateLeague({ ...DEFAULT_LEAGUE, roster: rosterFromCounts({ BN: 5 }) }, dataset)[0]).toMatch(/starting slot/);
    expect(validateLeague({ ...DEFAULT_LEAGUE, teams: 14, roster: standardRoster(7) }, dataset)[0]).toMatch(/224 picks.*215/);
  });
});

describe("leagueChanged", () => {
  it("ignores the Value/Reach threshold but not the draft shape", () => {
    expect(leagueChanged(DEFAULT_LEAGUE, { ...DEFAULT_LEAGUE, valueThreshold: 5 })).toBe(false);
    expect(leagueChanged(DEFAULT_LEAGUE, { ...DEFAULT_LEAGUE, mySlot: 2 })).toBe(true);
    expect(leagueChanged(DEFAULT_LEAGUE, { ...DEFAULT_LEAGUE, roster: standardRoster(6) })).toBe(true);
  });
});

describe("parseStoredLeague", () => {
  it("restores a saved league and rebuilds slot eligibility", () => {
    const saved = JSON.parse(JSON.stringify(fourteenSuperflex));
    saved.roster[0].eligible = ["K"]; // tampered
    expect(parseStoredLeague(saved)).toEqual(fourteenSuperflex);
  });

  it("rejects junk", () => {
    expect(parseStoredLeague(null)).toBeNull();
    expect(parseStoredLeague({ teams: 12 })).toBeNull();
    expect(parseStoredLeague({ ...DEFAULT_LEAGUE, roster: [{ key: "LB", eligible: [] }] })).toBeNull();
  });
});

describe("acceptance leagues run a full mock with valid rosters", () => {
  for (const [name, league] of [
    ["10 teams, slot 7", tenTeamSlot7],
    ["14 teams, SUPERFLEX", fourteenSuperflex],
  ] as const) {
    it(name, () => {
      const ctx = createSimContext(league, dataset.players);
      const caps = positionRules(league);
      for (let seed = 1; seed <= 20; seed++) {
        const picks = simulateFrom([], defaultRoom(league.teams), ctx, { autoMe: true, rng: mulberry32(seed) });
        expect(picks).toHaveLength(totalPicks(league));
        picks.forEach((p, i) => expect(p.mine).toBe(slotOf(i + 1, league.teams) === league.mySlot));
        const byTeam = new Map<number, Record<string, number>>();
        picks.forEach((p, i) => {
          const team = byTeam.get(slotOf(i + 1, league.teams)) ?? {};
          const pos = ctx.byId.get(p.playerId)!.pos;
          team[pos] = (team[pos] ?? 0) + 1;
          byTeam.set(slotOf(i + 1, league.teams), team);
        });
        for (const team of byTeam.values()) {
          for (const pos of Object.keys(team) as Position[]) expect(team[pos]).toBeLessThanOrEqual(caps[pos].cap);
        }
        // The user's roster fills every starting slot and conflicts compute without error.
        const { slots, overflow } = buildRoster(picks, (id) => ctx.byId.get(id), league.roster);
        expect(overflow).toEqual([]);
        expect(slots.filter((s) => s.slot.key !== "BN").every((s) => s.player)).toBe(true);
        expect(() => conflicts(slots)).not.toThrow();
      }
    });
  }

  it("SUPERFLEX teams draft a second QB", () => {
    const ctx = createSimContext(fourteenSuperflex, dataset.players);
    const picks = simulateFrom([], defaultRoom(14), ctx, { autoMe: true, rng: mulberry32(11) });
    const qbs = Array.from({ length: 14 }, (_, t) => picks.filter((p, i) => slotOf(i + 1, 14) === t + 1 && ctx.byId.get(p.playerId)!.pos === "QB").length);
    expect(qbs.filter((n) => n >= 2).length).toBeGreaterThanOrEqual(10);
  });
});
