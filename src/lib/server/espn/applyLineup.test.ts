import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { snapshotOf } from "@/lib/season/apply";
import { ESPN_SLOT_ID } from "@/lib/season/espnLeague";
import type { LineupMove } from "@/lib/season/lineup";
import type { LineupSlot, RosterEntry, SeasonLeague } from "@/lib/season/types";
import { applyLineup, type ApplyDeps } from "./applyLineup";
import type { EspnLineupWrite, EspnWrite } from "./lineupWriter";
import type { SeasonLoad } from "./seasonData";

vi.mock("server-only", () => ({}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const key = Buffer.alloc(32, 7);
const entry = (playerId: number, name: string, pos: RosterEntry["pos"], slot: LineupSlot, locked = false): RosterEntry => ({
  playerId,
  name,
  pos,
  team: "DET",
  slot,
  espnSlotId: ESPN_SLOT_ID[slot],
  locked,
  injuryStatus: "ACTIVE",
});

const ROSTER = [entry(1, "Qb", "QB", "QB"), entry(2, "Rb One", "RB", "RB"), entry(3, "Wr One", "WR", "WR"), entry(4, "Bench Rb", "RB", "BN"), entry(5, "Bench Wr", "WR", "BN"), entry(6, "Other Bench", "TE", "BN")];

function league(roster: RosterEntry[], week = 4): SeasonLeague {
  return {
    espnLeagueId: "704343562",
    season: 2026,
    name: "App Tester",
    currentWeek: week,
    finalWeek: 17,
    playoffStartWeek: 15,
    scoringItems: [],
    starters: [
      { key: "QB", count: 1 },
      { key: "RB", count: 1 },
      { key: "WR", count: 1 },
    ],
    benchSize: 3,
    teams: [
      { id: 1, name: "Mine", abbrev: "ME", roster },
      { id: 2, name: "Theirs", abbrev: "TH", roster: [entry(50, "Their Rb", "RB", "RB")] },
    ],
    pendingTrades: [],
  };
}

const ok = (lg: SeasonLeague): SeasonLoad => ({ kind: "ok", league: lg, espnTeamId: 1, fetchedAt: new Date(), stale: false });

/** A fake ESPN: reads return `reads` in turn, writes are recorded and answered with `answer`. */
function fake(reads: SeasonLoad[], answer: EspnWrite = { ok: true }) {
  const writes: EspnLineupWrite[] = [];
  const refreshes: boolean[] = [];
  const deps: ApplyDeps = {
    load: async (_db, _key, _user, _league, options) => {
      refreshes.push(!!options?.refresh);
      return reads.shift()!;
    },
    login: async () => ({ espnS2: "s2", swid: "{SWID}" }),
    write: async (_login, w) => {
      writes.push(w);
      return answer;
    },
  };
  return { deps, writes, refreshes };
}

const moved = (roster: RosterEntry[], moves: LineupMove[]) => roster.map((p) => ({ ...p, slot: moves.find((m) => m.playerId === p.playerId)?.to ?? p.slot }));

// Two swaps: the bench RB and WR start, Rb One and Wr One sit. Four LINEUP items in one transaction.
const MOVES: LineupMove[] = [
  { playerId: 2, from: "RB", to: "BN" },
  { playerId: 4, from: "BN", to: "RB" },
  { playerId: 3, from: "WR", to: "BN" },
  { playerId: 5, from: "BN", to: "WR" },
];

describe("applyLineup", () => {
  it("re-reads, writes every move in one transaction for the user's own team, and re-reads to confirm", async () => {
    const { deps, writes, refreshes } = fake([ok(league(ROSTER)), ok(league(moved(ROSTER, MOVES)))]);
    const out = await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, deps);
    expect(out).toEqual({ kind: "applied", moves: MOVES.map((m) => ({ ...m, landed: true })) });
    expect(refreshes).toEqual([true, true]);
    expect(writes).toEqual([
      {
        season: 2026,
        espnLeagueId: "704343562",
        teamId: 1,
        week: 4,
        items: [
          { playerId: 2, type: "LINEUP", fromLineupSlotId: 2, toLineupSlotId: 20 },
          { playerId: 4, type: "LINEUP", fromLineupSlotId: 20, toLineupSlotId: 2 },
          { playerId: 3, type: "LINEUP", fromLineupSlotId: 4, toLineupSlotId: 20 },
          { playerId: 5, type: "LINEUP", fromLineupSlotId: 20, toLineupSlotId: 4 },
        ],
      },
    ]);
  });

  it("aborts without writing when the roster changed since staging", async () => {
    const now = ROSTER.map((p) => (p.playerId === 4 ? { ...p, slot: "RB" as const } : p.playerId === 2 ? { ...p, slot: "BN" as const } : p));
    const { deps, writes } = fake([ok(league(now))]);
    const out = await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, deps);
    expect(out).toEqual({ kind: "changed", changes: ["Rb One moved from RB to the bench.", "Bench Rb moved from the bench to RB."] });
    expect(writes).toEqual([]);
  });

  it("refuses without writing when a player involved is now locked", async () => {
    const now = ROSTER.map((p) => (p.playerId === 3 ? { ...p, locked: true } : p));
    const { deps, writes } = fake([ok(league(now))]);
    const out = await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, deps);
    expect(out).toEqual({ kind: "refused", problems: ["Wr One's game has started, so ESPN won't move them this week."] });
    expect(writes).toEqual([]);
  });

  it("aborts when ESPN has moved on a week, or can only offer a stale read", async () => {
    const week = fake([ok(league(ROSTER, 5))]);
    expect(await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, week.deps)).toEqual({
      kind: "changed",
      changes: ["ESPN has moved on to week 5."],
    });
    const stale = fake([{ ...(ok(league(ROSTER)) as Extract<SeasonLoad, { kind: "ok" }>), stale: true }]);
    expect(await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, stale.deps)).toEqual({ kind: "problem", problem: "unavailable" });
    expect([...week.writes, ...stale.writes]).toEqual([]);
  });

  it("passes on ESPN's refusal", async () => {
    const errors = [{ type: "TRAN_ROSTER_SLOT_LIMIT_EXCEEDED", message: "Too many players in the RB slot (maximum 1)" }];
    const { deps } = fake([ok(league(ROSTER))], { ok: false, reason: "refused", detail: "HTTP 409 TRAN_ROSTER_SLOT_LIMIT_EXCEEDED", errors });
    const out = await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, deps);
    expect(out).toEqual({ kind: "espn-refused", errors, detail: "HTTP 409 TRAN_ROSTER_SLOT_LIMIT_EXCEEDED" });
  });

  it("checks a timed-out write against ESPN, since it may have landed", async () => {
    const timeout: EspnWrite = { ok: false, reason: "unavailable", detail: "timed out after 20s" };
    const landed = fake([ok(league(ROSTER)), ok(league(moved(ROSTER, MOVES)))], timeout);
    expect(await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, landed.deps)).toMatchObject({ kind: "applied" });
    const lost = fake([ok(league(ROSTER)), ok(league(ROSTER))], timeout);
    expect(await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, lost.deps)).toEqual({ kind: "write-failed", detail: "timed out after 20s" });
  });

  it("reports moves that didn't land, and a write it couldn't check", async () => {
    const partial = fake([ok(league(ROSTER)), ok(league(moved(ROSTER, MOVES.slice(0, 2))))]);
    const out = await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, partial.deps);
    expect(out.kind === "applied" && out.moves.map((m) => m.landed)).toEqual([true, true, false, false]);

    const blind = fake([ok(league(ROSTER)), { kind: "unavailable" }]);
    expect(await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, blind.deps)).toMatchObject({ kind: "unverified" });
  });

  it("marks the login disconnected when ESPN refuses it", async () => {
    const { deps } = fake([ok(league(ROSTER))], { ok: false, reason: "auth", detail: "HTTP 401" });
    expect(await applyLineup(db, key, "user", "league", { week: 4, snapshot: snapshotOf(ROSTER), moves: MOVES }, deps)).toEqual({ kind: "problem", problem: "disconnected" });
  });
});
