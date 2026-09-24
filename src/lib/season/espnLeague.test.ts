import { describe, expect, it } from "vitest";
import league from "./__fixtures__/espn-league-2026.json";
import { ESPN_SLOT_ID, ownTeamId, parsePendingTrades, parseSeasonLeague } from "./espnLeague";

describe("parseSeasonLeague", () => {
  const parsed = parseSeasonLeague(league, "110222051");
  if (!parsed.ok) throw new Error(parsed.error);
  const { league: season } = parsed;

  it("reads the week, the lineup and the scoring", () => {
    expect(season).toMatchObject({ season: 2026, name: "App Test 8.17", currentWeek: 3, finalWeek: 17, playoffStartWeek: 15, benchSize: 7 });
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

describe("parsePendingTrades", () => {
  // The shape of the dogfood league's mPendingTransactions on 2026-09-24, member ids left out.
  const pending = {
    pendingTransactions: [
      {
        id: "397af86f", type: "TRADE_ACCEPT", status: "PENDING", teamId: 8, teamActions: { "6": "ACCEPTED", "8": "ACCEPTED" },
        proposedDate: 1790174042513, expirationDate: 1790346842537, processDate: 1790346971933,
        items: [
          { playerId: 3128429, fromTeamId: 8, toTeamId: 6, type: "TRADE", fromLineupSlotId: 20, toLineupSlotId: -1 },
          { playerId: 4429205, fromTeamId: 6, toTeamId: 8, type: "TRADE", fromLineupSlotId: 20, toLineupSlotId: -1 },
        ],
      },
      {
        id: "efecb0eb", type: "TRADE_PROPOSAL", status: "PENDING", teamId: 8, teamActions: { "8": "ACCEPTED" }, expirationDate: 1790430104466,
        items: [
          { playerId: 4239996, fromTeamId: 8, toTeamId: 6, type: "TRADE" },
          { playerId: 4870808, fromTeamId: 6, toTeamId: 8, type: "TRADE" },
        ],
      },
      { id: "w1", type: "WAIVER", status: "PENDING", teamId: 6, items: [{ playerId: 1, fromTeamId: 0, toTeamId: 6, type: "ADD" }] },
      { id: "x", type: "TRADE_PROPOSAL", status: "CANCELED", teamId: 8, items: [{ playerId: 2, fromTeamId: 8, toTeamId: 6, type: "TRADE" }] },
    ],
  };

  it("reads proposals and accepted trades, with who proposed and every player's direction", () => {
    expect(parsePendingTrades(pending)).toEqual([
      {
        id: "397af86f",
        status: "accepted",
        proposerTeamId: 8,
        partnerTeamId: 6,
        moves: [
          { playerId: 3128429, fromTeamId: 8, toTeamId: 6 },
          { playerId: 4429205, fromTeamId: 6, toTeamId: 8 },
        ],
        proposedAt: new Date(1790174042513).toISOString(),
        expiresAt: new Date(1790346842537).toISOString(),
        processesAt: new Date(1790346971933).toISOString(),
      },
      expect.objectContaining({ id: "efecb0eb", status: "proposed", proposerTeamId: 8, partnerTeamId: 6, proposedAt: null, processesAt: null }),
    ]);
  });

  it("leaves out waiver claims, finished trades, and anything that isn't a list", () => {
    expect(parsePendingTrades({ pendingTransactions: pending.pendingTransactions.slice(2) })).toEqual([]);
    expect(parsePendingTrades({})).toEqual([]);
  });
});
