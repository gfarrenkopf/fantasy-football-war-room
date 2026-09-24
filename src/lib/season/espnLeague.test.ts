import { describe, expect, it } from "vitest";
import league from "./__fixtures__/espn-league-2026.json";
import { ESPN_SLOT_ID, ownTeamId, parseSeasonLeague } from "./espnLeague";

describe("parseSeasonLeague", () => {
  const parsed = parseSeasonLeague(league, "110222051");
  if (!parsed.ok) throw new Error(parsed.error);
  const { league: season } = parsed;

  it("reads the week, the lineup and the scoring", () => {
    expect(season).toMatchObject({ season: 2026, name: "App Test 8.17", currentWeek: 3, finalWeek: 17, benchSize: 7 });
    expect(season.starters).toEqual([
      { key: "QB", count: 1 },
      { key: "RB", count: 2 },
      { key: "WR", count: 2 },
      { key: "TE", count: 1 },
      { key: "FLEX", count: 1 },
      { key: "DST", count: 1 },
      { key: "K", count: 1 },
    ]);
    expect(season.scoringItems.length).toBeGreaterThan(40);
  });

  it("reads every team's roster with slots, locks and injuries", () => {
    expect(season.teams.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    const roster = season.teams[0].roster;
    expect(roster).toHaveLength(16);
    expect(roster.find((e) => e.name === "Jahmyr Gibbs")).toEqual({
      playerId: 4429795,
      name: "Jahmyr Gibbs",
      pos: "RB",
      team: "DET",
      slot: "RB",
      espnSlotId: 2,
      locked: false,
      injuryStatus: "ACTIVE",
    });
    expect(roster.find((e) => e.pos === "DST")).toMatchObject({ slot: "DST", espnSlotId: 16 });
    expect(roster.filter((e) => e.slot === "BN")).toHaveLength(7);
  });

  it("maps our slots back to ESPN's ids for writes", () => {
    expect(ESPN_SLOT_ID).toMatchObject({ QB: 0, RB: 2, WR: 4, TE: 6, FLEX: 23, SUPERFLEX: 7, DST: 16, K: 17, BN: 20, IR: 21 });
  });

  it("puts a player on IR in the IR slot, and leaves off positions War Room doesn't play", () => {
    const entry = (lineupSlotId: number, defaultPositionId: number) => ({
      playerId: lineupSlotId * 100 + defaultPositionId,
      lineupSlotId,
      playerPoolEntry: { lineupLocked: true, player: { fullName: "X", defaultPositionId, proTeamId: 8, injuryStatus: "OUT" } },
    });
    const raw = { ...league, teams: [{ id: 9, name: "T", abbrev: "T", roster: { entries: [entry(21, 2), entry(20, 11)] } }] };
    const parsed = parseSeasonLeague(raw, "1");
    expect(parsed.ok && parsed.league.teams[0].roster).toEqual([expect.objectContaining({ slot: "IR", locked: true, injuryStatus: "OUT" })]);
  });

  it("refuses a lineup slot War Room can't represent, and a document that isn't a league", () => {
    const idp = { ...league, settings: { ...league.settings, rosterSettings: { lineupSlotCounts: { "0": 1, "11": 1 } } } };
    expect(parseSeasonLeague(idp, "1")).toMatchObject({ ok: false, error: expect.stringContaining("slot 11") });
    expect(parseSeasonLeague({}, "1").ok).toBe(false);
  });
});

describe("ownTeamId", () => {
  it("finds the team this member owns, whatever the SWID's case or braces", () => {
    const doc = { teams: [{ id: 1, owners: ["{AAAA}"] }, { id: 2, owners: ["{154e132f-8c13-4ac0-9dac-20c2c5625594}"] }] };
    expect(ownTeamId(doc, "{154E132F-8C13-4AC0-9DAC-20C2C5625594}")).toBe(2);
    expect(ownTeamId(doc, "{BBBB}")).toBeNull();
    expect(ownTeamId(null, "{BBBB}")).toBeNull();
  });
});
