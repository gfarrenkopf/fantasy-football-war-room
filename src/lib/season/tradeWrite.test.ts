import { describe, expect, it } from "vitest";
import type { LineupSlotCount, PendingTrade } from "./types";
import { checkProposal, checkResponse, proposalItems, tradeLanded } from "./tradeWrite";

const p = (playerId: number, name: string, slot = "BN", tradeLocked = false) => ({ playerId, name, slot, ...(tradeLocked ? { tradeLocked } : {}) });
// Limit 3: one starter and a two-player bench.
const RULES = { starters: [{ key: "RB", count: 1 }] as LineupSlotCount[], benchSize: 2, tradeDeadline: "2026-11-25T17:00:00.000Z" };
const MINE = { id: 1, roster: [p(1, "Mine One", "RB"), p(2, "Mine Two"), p(3, "Mine Three")] };
const THEIRS = { id: 2, roster: [p(21, "Their One", "RB"), p(22, "Their Two"), p(23, "Locked", "BN", true)] };
const TEAMS = [MINE, THEIRS];
const NOW = Date.parse("2026-09-30T00:00:00Z");

describe("checkProposal", () => {
  it("passes a 1-for-1, and a 1-for-2 with a drop", () => {
    expect(checkProposal(TEAMS, RULES, { teamA: 1, gives: [2], teamB: 2, gets: [22] }, [], NOW)).toEqual([]);
    expect(checkProposal(TEAMS, RULES, { teamA: 1, gives: [2], teamB: 2, gets: [21, 22] }, [3], NOW)).toEqual([]);
  });

  it("refuses an overfull roster without a drop, a traded-locked player, a stale player, and the deadline", () => {
    expect(checkProposal(TEAMS, RULES, { teamA: 1, gives: [2], teamB: 2, gets: [21, 22] }, [], NOW)).toEqual(["That leaves you over 3 players. Drop someone too."]);
    expect(checkProposal(TEAMS, RULES, { teamA: 1, gives: [2], teamB: 2, gets: [23] }, [], NOW)).toEqual(["Locked is already in a trade, or can't be traded right now."]);
    expect(checkProposal(TEAMS, RULES, { teamA: 1, gives: [9], teamB: 2, gets: [22] }, [], NOW)).toContain("A player you picked isn't on your roster any more.");
    expect(checkProposal(TEAMS, RULES, { teamA: 1, gives: [2], teamB: 2, gets: [22] }, [2], NOW)).toEqual(["A player you're dropping isn't yours to drop."]);
    expect(checkProposal(TEAMS, RULES, { teamA: 1, gives: [2], teamB: 2, gets: [22] }, [], Date.parse("2026-12-01T00:00:00Z"))).toEqual(["The trade deadline has passed."]);
  });

  it("builds TRADE items both ways and DROP items for the user", () => {
    expect(proposalItems({ teamA: 1, gives: [2], teamB: 2, gets: [21, 22] }, [3])).toEqual([
      { playerId: 2, type: "TRADE", fromTeamId: 1, toTeamId: 2 },
      { playerId: 21, type: "TRADE", fromTeamId: 2, toTeamId: 1 },
      { playerId: 22, type: "TRADE", fromTeamId: 2, toTeamId: 1 },
      { playerId: 3, type: "DROP", fromTeamId: 1 },
    ]);
  });
});

const offer = (over: Partial<PendingTrade> = {}): PendingTrade => ({
  id: "t1",
  status: "proposed",
  proposerTeamId: 2,
  partnerTeamId: 1,
  moves: [
    { playerId: 22, fromTeamId: 2, toTeamId: 1 },
    { playerId: 2, fromTeamId: 1, toTeamId: 2 },
  ],
  proposedAt: null,
  expiresAt: null,
  processesAt: null,
  ...over,
});

describe("checkResponse", () => {
  it("lets the team an offer was made to accept or decline it, and the proposer withdraw it", () => {
    expect(checkResponse([offer()], TEAMS, RULES, 1, "t1", "accept", NOW)).toEqual([]);
    expect(checkResponse([offer()], TEAMS, RULES, 1, "t1", "decline", NOW)).toEqual([]);
    expect(checkResponse([offer()], TEAMS, RULES, 1, "t1", "withdraw", NOW)).toEqual(["Only the team that made an offer can withdraw it."]);
    expect(checkResponse([offer({ proposerTeamId: 1, partnerTeamId: 2 })], TEAMS, RULES, 1, "t1", "withdraw", NOW)).toEqual([]);
    expect(checkResponse([offer({ proposerTeamId: 1, partnerTeamId: 2 })], TEAMS, RULES, 1, "t1", "accept", NOW)).toEqual(["Only the team an offer was made to can answer it."]);
  });

  it("refuses an offer that's gone or already accepted, and an accept that overfills the roster", () => {
    expect(checkResponse([], TEAMS, RULES, 1, "t1", "decline", NOW)).toEqual(["That offer isn't open on ESPN any more."]);
    expect(checkResponse([offer({ status: "accepted" })], TEAMS, RULES, 1, "t1", "accept", NOW)).toEqual(["That offer isn't open on ESPN any more."]);
    const twoForOne = offer({ moves: [...offer().moves, { playerId: 21, fromTeamId: 2, toTeamId: 1 }] });
    expect(checkResponse([twoForOne], TEAMS, RULES, 1, "t1", "accept", NOW)).toEqual(["Accepting leaves you over 3 players. Make room on ESPN first."]);
  });
});

describe("tradeLanded", () => {
  it("reads a proposal or accept as pending in its new state, and a decline or withdraw as gone", () => {
    expect(tradeLanded([offer()], "t1", "propose")).toBe(true);
    expect(tradeLanded([offer({ status: "accepted" })], "t1", "accept")).toBe(true);
    expect(tradeLanded([offer()], "t1", "accept")).toBe(false);
    expect(tradeLanded([], "t1", "decline")).toBe(true);
    expect(tradeLanded([offer()], "t1", "withdraw")).toBe(false);
    expect(tradeLanded([offer()], null, "propose")).toBe(false);
  });
});
