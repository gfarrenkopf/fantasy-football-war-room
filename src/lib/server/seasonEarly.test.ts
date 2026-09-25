import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { espnSeasonLinks } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { SeasonEmail } from "@/lib/season/email";
import type { Schedule } from "@/lib/season/schedule";
import type { SeasonViewLoad } from "./espn/seasonView";
import { runEarlyJob, type EarlyDeps } from "./seasonEarly";
import { createTestLeague } from "./testLeagues";

const MIN = 60 * 1000;
const THURSDAY = Date.parse("2026-10-09T00:15:00Z"); // Thu Oct 8, 8:15 PM ET
const SUNDAY = Date.parse("2026-10-11T17:00:00Z"); // Sun Oct 11, 1:00 PM ET
// Week 5: DET and GB on Thursday night, everyone else in the Sunday 1 PM slot.
const schedule: Schedule = new Map([[5, new Map([["DET", THURSDAY], ["GB", THURSDAY], ["CHI", SUNDAY], ["MIN", SUNDAY], ["DAL", SUNDAY], ["NYG", SUNDAY]])]]);

// A Thursday back on the bench out-projects a Sunday starter: that move can't wait.
const thursdayMove = seasonView([at("QB", player("Sunday QB", "QB", 20, { team: "CHI" })), at("RB", player("Sunday RB", "RB", 15, { team: "CHI" })), at("RB", player("Weak RB", "RB", 6, { team: "CHI" })), at("FLEX", player("Flex RB", "RB", 5, { team: "MIN" })), player("Thursday Back", "RB", 14, { team: "DET" })]);
// The only change is between Sunday players.
const sundayMove = seasonView([at("QB", player("QB", "QB", 20, { team: "CHI" })), at("RB", player("RB1", "RB", 15, { team: "CHI" })), at("RB", player("RB2", "RB", 6, { team: "CHI" })), at("FLEX", player("Flex", "RB", 12, { team: "MIN" })), player("Sunday Bench", "RB", 14, { team: "DAL" }), player("Thursday Bench", "RB", 1, { team: "DET" })]);

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

let seq = 0;
async function link(userId: string, name: string, viewedDaysAgo: number) {
  const leagueId = await createTestLeague(db, userId, name);
  await db.insert(espnSeasonLinks).values({ leagueId, userId, espnLeagueId: String(5000 + ++seq), espnTeamId: 1, season: 2026, lastViewedAt: new Date(THURSDAY - viewedDaysAgo * 24 * 60 * MIN) });
  return leagueId;
}

describe("runEarlyJob", () => {
  let sent: { to: string; email: SeasonEmail }[];
  let loads: Map<string, SeasonViewLoad>;
  let deps: EarlyDeps;

  beforeEach(async () => {
    await db.delete(espnSeasonLinks);
    sent = [];
    loads = new Map();
    const ok = (view: typeof thursdayMove): SeasonViewLoad => ({ kind: "ok", view, fetchedAt: new Date(), stale: false, projectionsMissing: false });
    const alice = await createTestUser(db, `alice-${crypto.randomUUID()}@example.test`);
    const bob = await createTestUser(db, `bob-${crypto.randomUUID()}@example.test`);
    const carol = await createTestUser(db, `carol-${crypto.randomUUID()}@example.test`);
    loads.set(await link(alice, "Alice league", 1), ok(thursdayMove));
    loads.set(await link(bob, "Bob league", 1), ok(sundayMove));
    loads.set(await link(carol, "Carol idle", 20), ok(thursdayMove));
    deps = {
      schedule,
      loadView: async (_userId, leagueId) => loads.get(leagueId)!,
      sendEmail: async (to, email) => void sent.push({ to, email }),
      baseUrl: "https://draftroom.example",
      secret: "test-secret",
      now: new Date(THURSDAY - 70 * MIN),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("emails only the league with a move involving a Thursday player, skipping idle leagues", async () => {
    const summary = await runEarlyJob(db, deps);
    expect(summary).toEqual({ dryRun: false, kickoff: new Date(THURSDAY).toISOString(), leagues: 3, inactive: 1, withMoves: 1, failed: 0, emails: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toMatch(/^alice/);
    expect(sent[0].email.subject).toBe("Set your lineup before Thursday's 8:15 PM ET kickoff");
    expect(sent[0].email.text).toContain("- Start Thursday Back at FLEX over Flex RB");
  });

  it("does nothing outside the 60-75 minute window", async () => {
    for (const offset of [90, 59, -10]) {
      expect(await runEarlyJob(db, { ...deps, now: new Date(THURSDAY - offset * MIN) })).toMatchObject({ kickoff: null, emails: 0 });
    }
    // Nor for the main Sunday slot.
    expect((await runEarlyJob(db, { ...deps, now: new Date(SUNDAY - 70 * MIN) })).kickoff).toBeNull();
    expect(sent).toEqual([]);
  });

  it("sends nothing new on a rerun, and nothing in a dry run", async () => {
    await runEarlyJob(db, deps);
    expect((await runEarlyJob(db, { ...deps, now: new Date(THURSDAY - 62 * MIN) })).emails).toBe(0);
    expect(sent).toHaveLength(1);
    await db.delete(espnSeasonLinks);
    expect((await runEarlyJob(db, deps, { dryRun: true })).emails).toBe(0);
  });
});
