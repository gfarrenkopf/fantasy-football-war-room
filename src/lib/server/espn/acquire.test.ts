import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { snapshotOf } from "@/lib/season/apply";
import { ESPN_SLOT_ID } from "@/lib/season/espnLeague";
import type { LineupSlot, RosterEntry, SeasonLeague } from "@/lib/season/types";
import { addFreeAgent, cancelClaim, claimWaiver } from "./acquire";
import type { WriteDeps } from "./guardedWrite";
import type { SeasonLoad } from "./seasonData";
import type { EspnTransaction, EspnWrite } from "./transactionWriter";

vi.mock("server-only", () => ({}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const key = Buffer.alloc(32, 7);
const entry = (playerId: number, name: string, slot: LineupSlot, locked = false): RosterEntry => ({
  playerId,
  name,
  pos: "RB",
  team: "DET",
  slot,
  espnSlotId: ESPN_SLOT_ID[slot],
  locked,
  injuryStatus: "ACTIVE",
  actual: null,
  statLine: null,
  ownership: null,
  news: null,
});

// Limit 3: one starter and a two-player bench.
const ROSTER = [entry(1, "Rb", "RB"), entry(2, "Bench One", "BN"), entry(3, "Bench Two", "BN")];
const FREE_AGENT = 99;

function league(roster: RosterEntry[], theirs: RosterEntry[] = [], more: Partial<SeasonLeague> = {}): SeasonLeague {
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
    irSlots: 1,
    teams: [
      { id: 1, name: "Mine", abbrev: "ME", roster, standing: null },
      { id: 2, name: "Theirs", abbrev: "TH", roster: theirs, standing: null },
    ],
    pendingTrades: [],
    pendingClaims: [],
    draftOrder: [],
    tradeDeadline: null,
    matchups: [],
    results: [],
    waivers: { budget: null, teams: [] },
    ...more,
  };
}

const ok = (lg: SeasonLeague): SeasonLoad => ({ kind: "ok", league: lg, espnTeamId: 1, fetchedAt: new Date(), stale: false });

function fake(reads: SeasonLoad[], answer: EspnWrite = { ok: true, id: "tx" }) {
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

const request = { week: 4, snapshot: snapshotOf(ROSTER), add: FREE_AGENT, drop: 3 };

describe("addFreeAgent", () => {
  it("writes one FREEAGENT transaction for the user's team and confirms the swap from a re-read", async () => {
    const after = [...ROSTER.slice(0, 2), entry(FREE_AGENT, "New Rb", "BN")];
    const { deps, writes } = fake([ok(league(ROSTER)), ok(league(after))]);
    expect(await addFreeAgent(db, key, "user", "league", request, deps)).toEqual({ kind: "applied", landed: { added: true, dropped: true } });
    expect(writes).toEqual([
      {
        season: 2026,
        espnLeagueId: "704343562",
        teamId: 1,
        week: 4,
        type: "FREEAGENT",
        items: [
          { playerId: FREE_AGENT, type: "ADD", toTeamId: 1 },
          { playerId: 3, type: "DROP", fromTeamId: 1 },
        ],
      },
    ]);
  });

  it("refuses without writing: a full roster with no drop, a locked drop, a player someone else has", async () => {
    const full = fake([ok(league(ROSTER))]);
    expect(await addFreeAgent(db, key, "user", "league", { ...request, drop: null }, full.deps)).toEqual({ kind: "refused", problems: ["Your roster is full at 3 players. Pick someone to drop."] });
    const locked = ROSTER.map((p) => (p.playerId === 3 ? { ...p, locked: true } : p));
    const lockedDrop = fake([ok(league(locked))]);
    expect(await addFreeAgent(db, key, "user", "league", { ...request, snapshot: snapshotOf(locked) }, lockedDrop.deps)).toMatchObject({ kind: "refused" });
    const taken = fake([ok(league(ROSTER, [entry(FREE_AGENT, "New Rb", "BN")]))]);
    expect(await addFreeAgent(db, key, "user", "league", request, taken.deps)).toEqual({ kind: "refused", problems: ["That player is on Theirs now."] });
    expect([...full.writes, ...lockedDrop.writes, ...taken.writes]).toEqual([]);
  });

  it("passes on ESPN refusing a player who isn't a free agent", async () => {
    const errors = [{ type: "TRAN_PLAYER_NOT_FREEAGENT", message: "X is not a free agent" }];
    const { deps } = fake([ok(league(ROSTER))], { ok: false, reason: "refused", detail: "HTTP 409 TRAN_PLAYER_NOT_FREEAGENT", errors });
    expect(await addFreeAgent(db, key, "user", "league", request, deps)).toEqual({ kind: "espn-refused", errors, detail: "HTTP 409 TRAN_PLAYER_NOT_FREEAGENT" });
  });
});

const PENDING = { id: "c1", teamId: 1, add: FREE_AGENT, drop: 3, bid: 0, processesAt: "2026-09-30T07:00:00.000Z" };
const FAAB = { waivers: { budget: 100, teams: [{ teamId: 1, rank: 2, spent: 70 }] } };

describe("claimWaiver", () => {
  it("writes one WAIVER transaction and confirms the claim is pending from a re-read", async () => {
    const { deps, writes } = fake([ok(league(ROSTER)), ok(league(ROSTER, [], { pendingClaims: [PENDING] }))], { ok: true, id: "c1" });
    expect(await claimWaiver(db, key, "user", "league", request, deps)).toEqual({ kind: "applied", landed: { pending: true } });
    expect(writes[0]).toMatchObject({ type: "WAIVER", bidAmount: null, items: [{ playerId: FREE_AGENT, type: "ADD", toTeamId: 1 }, { playerId: 3, type: "DROP", fromTeamId: 1 }] });
  });

  it("refuses a claim in a league that bids FAAB, without writing", async () => {
    const over = fake([ok(league(ROSTER, [], FAAB))]);
    expect(await claimWaiver(db, key, "user", "league", request, over.deps)).toEqual({ kind: "refused", problems: ["This league bids on waivers. Place FAAB claims on ESPN for now."] });
    expect(over.writes).toEqual([]);
  });
});

describe("cancelClaim", () => {
  it("cancels a pending claim by id with no items, and confirms it's gone", async () => {
    const { deps, writes } = fake([ok(league(ROSTER, [], { pendingClaims: [PENDING] })), ok(league(ROSTER))]);
    expect(await cancelClaim(db, key, "user", "league", { week: 4, claimId: "c1" }, deps)).toEqual({ kind: "applied", landed: { cancelled: true } });
    expect(writes[0]).toMatchObject({ type: "WAIVER", executionType: "CANCEL", relatedTransactionId: "c1", items: [] });
  });

  it("refuses a claim that isn't pending any more, and doesn't mind roster changes", async () => {
    const { deps, writes } = fake([ok(league(ROSTER.slice(1)))]);
    expect(await cancelClaim(db, key, "user", "league", { week: 4, claimId: "c1" }, deps)).toEqual({ kind: "refused", problems: ["That claim isn't pending on ESPN any more."] });
    expect(writes).toEqual([]);
  });
});
