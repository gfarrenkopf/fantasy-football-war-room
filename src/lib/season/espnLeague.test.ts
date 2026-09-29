import { describe, expect, it } from "vitest";
import league from "./__fixtures__/espn-league-2026.json";
import { ESPN_SLOT_ID, ownTeamId, parseFreeAgents, parseMatchups, parsePendingTrades, parseSeasonLeague } from "./espnLeague";

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
      actual: null,
      ownership: null,
      news: null,
    });
    expect(roster.find((e) => e.pos === "DST")).toMatchObject({ slot: "DST", espnSlotId: 16 });
    expect(roster.filter((e) => e.slot === "BN")).toHaveLength(7);
  });

  it("reads this week's league-scored points once a player's game starts, and nothing else", () => {
    const row = (over: Record<string, number>) => ({ statSourceId: 0, statSplitTypeId: 1, seasonId: 2026, scoringPeriodId: 3, appliedTotal: 12.345, ...over });
    const entry = (playerId: number, stats: unknown[]) => ({
      playerId,
      lineupSlotId: 2,
      playerPoolEntry: { player: { fullName: "X", defaultPositionId: 2, proTeamId: 8, stats } },
    });
    const raw = {
      ...league,
      teams: [
        {
          id: 9,
          roster: {
            entries: [
              entry(1, [row({})]),
              entry(2, [row({ scoringPeriodId: 2 }), row({ seasonId: 2025 }), row({ statSourceId: 1 }), row({ statSplitTypeId: 0 })]),
              entry(3, []),
            ],
          },
        },
      ],
    };
    const parsed = parseSeasonLeague(raw, "1");
    expect(parsed.ok && parsed.league.teams[0].roster.map((e) => e.actual)).toEqual([12.35, null, null]);
  });

  it("reads ESPN's ownership and this week's outlook, and leaves out other weeks' outlooks", () => {
    const entry = (playerId: number, player: Record<string, unknown>) => ({
      playerId,
      lineupSlotId: 2,
      playerPoolEntry: { player: { fullName: "X", defaultPositionId: 2, proTeamId: 8, ...player } },
    });
    const raw = {
      ...league,
      teams: [
        {
          id: 9,
          roster: {
            entries: [
              entry(1, { ownership: { percentOwned: 64.4, percentStarted: 40.6 }, outlooks: { outlooksByWeek: { "3": " Gets the start. " } }, lastNewsDate: 1790654254000 }),
              entry(2, { outlooks: { outlooksByWeek: { "2": "Last week's." } } }),
            ],
          },
        },
      ],
    };
    const parsed = parseSeasonLeague(raw, "1");
    if (!parsed.ok) throw new Error(parsed.error);
    const [a, b] = parsed.league.teams[0].roster;
    expect(a).toMatchObject({ ownership: { owned: 64, started: 41 }, news: { note: "Gets the start.", at: "2026-09-29T03:57:34.000Z" } });
    expect(b).toMatchObject({ ownership: null, news: null });
  });

  it("reads each team's record and seed, and the trade deadline", () => {
    const raw = {
      ...league,
      settings: { ...league.settings, tradeSettings: { deadlineDate: 1796230800000 } },
      teams: [
        { id: 9, playoffSeed: 2, record: { overall: { wins: 3, losses: 1, ties: 0, pointsFor: 480.456, pointsAgainst: 401.2 } }, roster: { entries: [] } },
        { id: 10, roster: { entries: [] } },
      ],
    };
    const parsed = parseSeasonLeague(raw, "1");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.league.teams.map((t) => t.standing)).toEqual([{ wins: 3, losses: 1, ties: 0, pointsFor: 480.46, pointsAgainst: 401.2, seed: 2 }, null]);
    expect(parsed.league.tradeDeadline).toBe("2026-12-02T17:00:00.000Z");
  });

  it("reads the league's FAAB budget and each team's waiver rank and spend", () => {
    const raw = {
      ...league,
      settings: { ...league.settings, acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100 } },
      teams: [
        { id: 9, waiverRank: 4, transactionCounter: { acquisitionBudgetSpent: 23 }, roster: { entries: [] } },
        { id: 10, roster: { entries: [] } },
      ],
    };
    const parsed = parseSeasonLeague(raw, "1");
    expect(parsed.ok && parsed.league.waivers).toEqual({
      budget: 100,
      teams: [
        { teamId: 9, rank: 4, spent: 23 },
        { teamId: 10, rank: null, spent: 0 },
      ],
    });
    const noBids = parseSeasonLeague({ ...raw, settings: { ...raw.settings, acquisitionSettings: { isUsingAcquisitionBudget: false, acquisitionBudget: 100 } } }, "1");
    expect(noBids.ok && noBids.league.waivers.budget).toBeNull();
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

describe("parseMatchups", () => {
  const side = (teamId: number, over = {}) => ({ teamId, totalPoints: 0, totalPointsLive: 12.345, totalProjectedPoints: 120, totalProjectedPointsLive: 118.5, winProbability: 0.49, ...over });
  const raw = {
    status: { currentMatchupPeriod: 4 },
    schedule: [
      { matchupPeriodId: 3, home: side(1), away: side(2) },
      { matchupPeriodId: 4, home: side(1), away: side(2, { winProbability: 0.51, totalPointsLive: undefined, totalPoints: 7 }) },
      { matchupPeriodId: 4, home: side(3) },
      { matchupPeriodId: 4, home: null },
    ],
  };

  it("reads this period's matchups with ESPN's live points, projections and odds, and a bye's lone side", () => {
    expect(parseMatchups(raw)).toEqual([
      {
        home: { teamId: 1, points: 12.35, projected: 118.5, winProbability: 0.49 },
        away: { teamId: 2, points: 7, projected: 118.5, winProbability: 0.51 },
      },
      { home: { teamId: 3, points: 12.35, projected: 118.5, winProbability: 0.49 }, away: null },
    ]);
  });

  it("is empty without a schedule", () => {
    expect(parseMatchups({ status: {} })).toEqual([]);
    expect(parseMatchups(null)).toEqual([]);
  });
});

describe("parseFreeAgents", () => {
  it("reads available players, when a waiver claim clears, and leaves out what War Room doesn't play", () => {
    const player = (id: number, status: string, defaultPositionId = 2, extra = {}) => ({
      id,
      status,
      waiverProcessDate: 1790751600000,
      player: { fullName: `P${id}`, defaultPositionId, proTeamId: 8, injuryStatus: "QUESTIONABLE", ownership: { percentOwned: 12.4, percentStarted: 3.2 }, ...extra },
    });
    expect(parseFreeAgents({ players: [player(1, "WAIVERS"), player(2, "FREEAGENT", 3), player(3, "ONTEAM"), player(4, "FREEAGENT", 11), null] })).toEqual([
      { playerId: 1, name: "P1", pos: "RB", team: "DET", injuryStatus: "QUESTIONABLE", status: "WAIVERS", waiverClears: "2026-09-30T07:00:00.000Z", ownership: { owned: 12, started: 3 } },
      { playerId: 2, name: "P2", pos: "WR", team: "DET", injuryStatus: "QUESTIONABLE", status: "FREEAGENT", waiverClears: null, ownership: { owned: 12, started: 3 } },
    ]);
    expect(parseFreeAgents({})).toEqual([]);
  });
});
