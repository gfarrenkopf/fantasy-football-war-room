import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { espnSeasonLinks } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { SeasonEmail } from "@/lib/season/email";
import type { Schedule } from "@/lib/season/schedule";
import type { SeasonViewLoad } from "./espn/seasonView";
import { createAppSession } from "./appAuth";
import { registerDevice } from "./devices";
import type { PushAlert } from "./push";
import { runEarlyJob, type EarlyDeps } from "./seasonEarly";
import { projectionAccuracy } from "./seasonProjections";
import { createTestLeague } from "./testLeagues";

const MIN = 60 * 1000;
const THURSDAY = Date.parse("2026-10-09T00:15:00Z"); // Thu Oct 8, 8:15 PM ET
const SUNDAY = Date.parse("2026-10-11T17:00:00Z"); // Sun Oct 11, 1:00 PM ET
const NIGHT = Date.parse("2026-10-12T00:20:00Z"); // Sun Oct 11, 8:20 PM ET
// Week 5: DET and GB on Thursday night, SF and SEA on Sunday night, everyone else in the Sunday 1 PM slot.
const schedule: Schedule = new Map([[5, new Map([["DET", THURSDAY], ["GB", THURSDAY], ["CHI", SUNDAY], ["MIN", SUNDAY], ["DAL", SUNDAY], ["NYG", SUNDAY], ["SF", NIGHT], ["SEA", NIGHT]])]]);

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
    const ok = (view: typeof thursdayMove): SeasonViewLoad => ({ kind: "ok", view, fetchedAt: new Date(), stale: false, projectionsMissing: false, phase: "lineup" });
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
    expect(summary).toEqual({ dryRun: false, kickoff: new Date(THURSDAY).toISOString(), when: "early", leagues: 3, inactive: 1, withMoves: 1, failed: 0, emails: 1, pushes: 0, reminders: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toMatch(/^alice/);
    expect(sent[0].email.subject).toBe("Set your lineup before Thursday's 8:15 PM ET kickoff");
    expect(sent[0].email.text).toContain("- Start Thursday Back at FLEX over Flex RB");
  });

  it("records the Thursday players' projections before kickoff", async () => {
    const game = { state: "pre" as const, detail: "", opponent: "GB", home: true, kickoff: new Date(THURSDAY).toISOString(), period: 0, clockSeconds: 0, score: null };
    const back = player("Thursday Back", "RB", 14, { team: "DET", game });
    const userId = await createTestUser(db);
    const leagueId = await link(userId, "Recorded", 1);
    loads.set(leagueId, { kind: "ok", view: seasonView([back]), fetchedAt: new Date(), stale: false, projectionsMissing: false, phase: "lineup" });
    await runEarlyJob(db, deps);
    expect((await projectionAccuracy(db, leagueId, seasonView([back]))).players).toEqual([{ playerId: back.playerId, projected: 14, actual: null }]);
  });

  it("leads with a hole whose player is in the early game (APE-352)", async () => {
    const userId = await createTestUser(db, `erin-${crypto.randomUUID()}@example.test`);
    const leagueId = await link(userId, "Erin league", 1);
    const roster = thursdayMove.teams[0].roster.filter((p) => p.pos !== "QB");
    loads.set(leagueId, { kind: "ok", view: seasonView([at("QB", player("Thursday QB", "QB", 0, { team: "DET", injuryStatus: "OUT" })), ...roster]), fetchedAt: new Date(), stale: false, projectionsMissing: false, phase: "lineup" });
    await runEarlyJob(db, deps);
    const erin = sent.find((m) => m.to.startsWith("erin"))!.email;
    expect(erin.text).toContain("Erin league\n- Hole at QB: Thursday QB is out, and nobody else can play QB. Fill it before kickoff.\n");
  });

  describe("a late kickoff (APE-347)", () => {
    const ok = (view: typeof thursdayMove): SeasonViewLoad => ({ kind: "ok", view, fetchedAt: new Date(), stale: false, projectionsMissing: false, phase: "lineup" });
    const sundayRest = thursdayMove.teams[0].roster.filter((p) => p.pos !== "QB");
    const nightQb = (over: Partial<ReturnType<typeof player>> = {}) => player("Night QB", "QB", 0, { team: "SF", injuryStatus: "OUT", ...over });

    it("emails only a hole whose player is in that game, with its fill, and no other moves", async () => {
      const qb = nightQb();
      const userId = await createTestUser(db, `fran-${crypto.randomUUID()}@example.test`);
      loads.set(await link(userId, "Fran league", 1), ok(seasonView([at("QB", qb), ...sundayRest])));
      const backup = { ...player("Backup QB", "QB", 16.2, { team: "SEA" }), status: "FREEAGENT" as const, waiverClears: null };
      const summary = await runEarlyJob(db, {
        ...deps,
        now: new Date(NIGHT - 70 * MIN),
        loadFills: async () => [{ hole: { key: "QB", kind: "hard", reason: "out", playerId: qb.playerId, kickoff: null }, fills: [{ player: backup, drop: null, ir: null }], claims: [] }],
      });
      // Alice's Thursday move isn't a late game's business.
      expect(summary).toMatchObject({ when: "late", withMoves: 1, emails: 1 });
      expect(sent).toHaveLength(1);
      expect(sent[0].email.subject).toBe("Fill a hole in your lineup before Sunday's 8:20 PM ET kickoff");
      expect(sent[0].email.text).toContain("Fran league\n- Hole at QB: Night QB is out, and nobody else can play QB. Add Backup QB (16.2 pts).\n");
    });

    it("says so when nobody on the wire can play in time", async () => {
      const userId = await createTestUser(db, `gus-${crypto.randomUUID()}@example.test`);
      const qb = nightQb();
      loads.set(await link(userId, "Gus league", 1), ok(seasonView([at("QB", qb), ...sundayRest])));
      await runEarlyJob(db, { ...deps, now: new Date(NIGHT - 70 * MIN), loadFills: async () => [{ hole: { key: "QB", kind: "hard", reason: "out", playerId: qb.playerId, kickoff: null }, fills: [], claims: [] }] });
      expect(sent[0].email.text).toContain("- Hole at QB: Night QB is out, and nobody else can play QB. Nobody on the wire can play in time.\n");
    });

    it("sends nothing when the starter in that game is healthy, or his game has locked", async () => {
      for (const qb of [nightQb({ injuryStatus: "ACTIVE", points: 20 }), nightQb({ locked: true })]) {
        loads.set(await link(await createTestUser(db), "Quiet", 1), ok(seasonView([at("QB", qb), ...sundayRest])));
      }
      expect(await runEarlyJob(db, { ...deps, now: new Date(NIGHT - 70 * MIN) })).toMatchObject({ when: "late", withMoves: 0, emails: 0 });
      expect(sent).toEqual([]);
    });
  });

  describe("pushes (21.4)", () => {
    const ok = (view: typeof thursdayMove): SeasonViewLoad => ({ kind: "ok", view, fetchedAt: new Date(), stale: false, projectionsMissing: false, phase: "lineup" });
    let pushes: { userId: string; alert: PushAlert }[];
    beforeEach(() => {
      pushes = [];
      deps.sendPush = async (userId, alert) => {
        pushes.push({ userId, alert });
        return { sent: 1, removed: 0, failed: 0 };
      };
    });
    async function withPhone(name: string) {
      const userId = await createTestUser(db, `${name}-${crypto.randomUUID()}@example.test`);
      const { token } = await createAppSession(db, userId);
      await registerDevice(db, userId, token, { token: crypto.randomUUID().replaceAll("-", "").repeat(2), environment: "production", appVersion: "1.0" });
      return userId;
    }

    it("pushes a starter ruled out for a late game, time-sensitive, to his slot, once", async () => {
      const qb = player("Night QB", "QB", 0, { team: "SF", injuryStatus: "OUT" });
      const userId = await withPhone("hal");
      const leagueId = await link(userId, "Hal league", 1);
      loads.set(leagueId, ok(seasonView([at("QB", qb), ...thursdayMove.teams[0].roster.filter((p) => p.pos !== "QB")])));
      const late = { ...deps, now: new Date(NIGHT - 70 * MIN) };
      expect(await runEarlyJob(db, late)).toMatchObject({ when: "late", emails: 1, pushes: 1 });
      expect(pushes).toEqual([
        {
          userId,
          alert: {
            title: "Night QB is out",
            body: "Hole at QB: Night QB is out, and nobody else can play QB. Fill it before Sunday's 8:20 PM ET kickoff.",
            data: { leagueId, tab: "lineup", playerId: String(qb.playerId) },
            threadId: `league-${leagueId}`,
            category: "lineup-hole",
            timeSensitive: true,
          },
        },
      ]);
      expect(await runEarlyJob(db, late)).toMatchObject({ emails: 0, pushes: 0 });
      expect(pushes).toHaveLength(1);
    });

    it("reminds a user with the app of a hole before the week's first kickoff, leaving that game's to the kickoff alert", async () => {
      const ruledOut = player("Sunday RB", "RB", 0, { team: "CHI", injuryStatus: "OUT" });
      const thursdayOut = player("Thursday QB", "QB", 0, { team: "DET", injuryStatus: "OUT" });
      const view = seasonView([at("QB", thursdayOut), at("RB", ruledOut), at("RB", player("RB2", "RB", 6, { team: "CHI" })), at("FLEX", player("Flex WR", "WR", 5, { team: "MIN" }))]);
      const userId = await withPhone("ida");
      const leagueId = await link(userId, "Ida league", 1);
      loads.set(leagueId, ok(view));
      // Without the app there's no reminder: it's push-only.
      loads.set(await link(await createTestUser(db), "No app", 1), ok(view));

      const summary = await runEarlyJob(db, deps);
      expect(summary).toMatchObject({ when: "early", reminders: 1 });
      const reminder = pushes.find((p) => p.alert.collapseId === "lineup-reminder")!;
      expect(reminder).toEqual({
        userId,
        alert: {
          title: "Your lineup has a hole",
          body: "Ida league: Hole at RB: Sunday RB is out, and nobody else can play RB.",
          data: { leagueId, tab: "lineup" },
          threadId: `league-${leagueId}`,
          category: "lineup-hole",
          collapseId: "lineup-reminder",
        },
      });
      // The Thursday hole went in the kickoff alert, not the time-sensitive one.
      expect(pushes.filter((p) => p.userId === userId).map((p) => p.alert.title)).toEqual(["Set your lineup before Thursday's 8:15 PM ET kickoff", "Your lineup has a hole"]);
      expect((await runEarlyJob(db, deps)).reminders).toBe(0);
    });

    it("sends no reminder before a later early kickoff", async () => {
      const LONDON = Date.parse("2026-10-11T13:30:00Z"); // Sun 9:30 AM ET, after Thursday
      const withLondon: Schedule = new Map([[5, new Map([...schedule.get(5)!, ["JAX", LONDON], ["PIT", LONDON]])]]);
      const userId = await withPhone("jo");
      loads.set(await link(userId, "Jo league", 1), ok(seasonView([at("RB", player("Sunday RB", "RB", 0, { team: "CHI", injuryStatus: "OUT" }))])));
      expect(await runEarlyJob(db, { ...deps, schedule: withLondon, now: new Date(LONDON - 70 * MIN) })).toMatchObject({ when: "early", reminders: 0 });
    });
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
