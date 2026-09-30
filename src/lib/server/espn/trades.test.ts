import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { snapshotOf } from "@/lib/season/apply";
import { ESPN_SLOT_ID } from "@/lib/season/espnLeague";
import type { LineupSlot, PendingTrade, RosterEntry, SeasonLeague } from "@/lib/season/types";
import type { WriteDeps } from "./guardedWrite";
import type { SeasonLoad } from "./seasonData";
import { proposeTrade, respondToTrade } from "./trades";
import type { EspnTransaction, EspnWrite } from "./transactionWriter";

vi.mock("server-only", () => ({}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const key = Buffer.alloc(32, 7);
const NOW = () => Date.parse("2026-09-30T00:00:00Z");
const entry = (playerId: number, name: string, slot: LineupSlot = "BN"): RosterEntry => ({
  playerId,
  name,
  pos: "RB",
  team: "DET",
  slot,
  espnSlotId: ESPN_SLOT_ID[slot],
  locked: false,
  injuryStatus: "ACTIVE",
  actual: null,
  ownership: null,
  news: null,
});
const MINE = [entry(1, "Mine One", "RB"), entry(2, "Mine Two"), entry(3, "Mine Three")];
const THEIRS = [entry(21, "Their One", "RB"), entry(22, "Their Two")];
const OFFER: PendingTrade = {
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
};

function league(pendingTrades: PendingTrade[] = []): SeasonLeague {
  return {
    espnLeagueId: "704343562",
    season: 2026,
    name: "App Tester",
    currentWeek: 4,
    finalWeek: 17,
    playoffStartWeek: 15,
    scoringItems: [],
    starters: [{ key: "RB", count: 1 }],
    benchSize: 2,
    teams: [
      { id: 1, name: "Mine", abbrev: "ME", roster: MINE, standing: null },
      { id: 2, name: "Theirs", abbrev: "TH", roster: THEIRS, standing: null },
    ],
    pendingTrades,
    pendingClaims: [],
    tradeDeadline: "2026-11-25T17:00:00.000Z",
    matchups: [],
    waivers: { budget: null, teams: [] },
  };
}

const ok = (lg: SeasonLeague): SeasonLoad => ({ kind: "ok", league: lg, espnTeamId: 1, fetchedAt: new Date(), stale: false });

function fake(reads: SeasonLoad[], answer: EspnWrite = { ok: true, id: "t9" }) {
  const writes: EspnTransaction[] = [];
  const deps: WriteDeps = {
    load: async () => reads.shift()!,
    login: async () => ({ espnS2: "s2", swid: "{SWID}" }),
    write: async (_login, w) => {
      writes.push(w);
      return answer;
    },
  };
  return { deps, writes };
}

describe("proposeTrade", () => {
  it("proposes to the partner with TRADE items and confirms it's pending", async () => {
    const mineOut = { ...OFFER, id: "t9", proposerTeamId: 1, partnerTeamId: 2 };
    const { deps, writes } = fake([ok(league()), ok(league([mineOut]))]);
    const out = await proposeTrade(db, key, "user", "league", { week: 4, snapshot: snapshotOf(MINE), partner: 2, gives: [2], gets: [22], drops: [] }, deps, NOW);
    expect(out).toEqual({ kind: "applied", landed: { pending: true } });
    expect(writes[0]).toMatchObject({
      teamId: 1,
      type: "TRADE_PROPOSAL",
      items: [
        { playerId: 2, type: "TRADE", fromTeamId: 1, toTeamId: 2 },
        { playerId: 22, type: "TRADE", fromTeamId: 2, toTeamId: 1 },
      ],
    });
  });

  it("refuses a proposal that overfills the user's roster, without writing", async () => {
    const { deps, writes } = fake([ok(league())]);
    const out = await proposeTrade(db, key, "user", "league", { week: 4, snapshot: snapshotOf(MINE), partner: 2, gives: [2], gets: [21, 22], drops: [] }, deps, NOW);
    expect(out).toEqual({ kind: "refused", problems: ["That leaves you over 3 players. Drop someone too."] });
    expect(writes).toEqual([]);
  });
});

describe("respondToTrade", () => {
  it("accepts by id with no items, and sees the trade in review", async () => {
    const { deps, writes } = fake([ok(league([OFFER])), ok(league([{ ...OFFER, status: "accepted" }]))]);
    expect(await respondToTrade(db, key, "user", "league", { week: 4, snapshot: snapshotOf(MINE), tradeId: "t1", action: "accept" }, deps, NOW)).toEqual({ kind: "applied", landed: { done: true } });
    expect(writes[0]).toMatchObject({ type: "TRADE_ACCEPT", relatedTransactionId: "t1" });
    expect(writes[0].items).toBeUndefined();
  });

  it("declines, and withdraws the user's own offer as a CANCEL", async () => {
    const decline = fake([ok(league([OFFER])), ok(league())]);
    expect(await respondToTrade(db, key, "user", "league", { week: 4, snapshot: null, tradeId: "t1", action: "decline" }, decline.deps, NOW)).toEqual({ kind: "applied", landed: { done: true } });
    expect(decline.writes[0]).toMatchObject({ type: "TRADE_DECLINE", relatedTransactionId: "t1" });

    const mine = { ...OFFER, proposerTeamId: 1, partnerTeamId: 2 };
    const withdraw = fake([ok(league([mine])), ok(league())]);
    expect(await respondToTrade(db, key, "user", "league", { week: 4, snapshot: null, tradeId: "t1", action: "withdraw" }, withdraw.deps, NOW)).toMatchObject({ kind: "applied" });
    expect(withdraw.writes[0]).toMatchObject({ type: "TRADE_PROPOSAL", executionType: "CANCEL", relatedTransactionId: "t1", items: [] });
  });

  it("refuses to answer an offer that's gone, without writing", async () => {
    const { deps, writes } = fake([ok(league())]);
    expect(await respondToTrade(db, key, "user", "league", { week: 4, snapshot: null, tradeId: "t1", action: "decline" }, deps, NOW)).toEqual({ kind: "refused", problems: ["That offer isn't open on ESPN any more."] });
    expect(writes).toEqual([]);
  });
});
