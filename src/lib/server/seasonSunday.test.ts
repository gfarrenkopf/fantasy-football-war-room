import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanModelError } from "@/lib/ai/provider";
import { createFakePlanModel } from "@/lib/ai/providers/fake";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { espnSeasonLinks } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { SeasonEmail } from "@/lib/season/email";
import { grantEntitlement, SEASON_PASS } from "./entitlements";
import type { SeasonViewLoad } from "./espn/seasonView";
import { startTrial } from "./seasonAi";
import { findAiLineups } from "./seasonAiOutputs";
import { setSeasonEmails, verifyUnsubscribeToken } from "./seasonPrefs";
import { runSundayJob, type SundayDeps } from "./seasonSunday";
import { createTestLeague } from "./testLeagues";

const NOW = new Date("2026-10-11T15:40:00Z"); // a Sunday, 11:40 ET
const DAY = 24 * 60 * 60 * 1000;
const bench = player("Bench Back", "RB", 14);
const view = seasonView([at("QB", player("QB", "QB", 20)), at("RB", player("RB1", "RB", 15)), at("RB", player("RB2", "RB", 6)), bench]); // week 5
const ok: SeasonViewLoad = { kind: "ok", view, fetchedAt: NOW, stale: false, projectionsMissing: false };

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

let seq = 0;
async function link(userId: string, name: string, viewedDaysAgo: number | null) {
  const leagueId = await createTestLeague(db, userId, name);
  await db.insert(espnSeasonLinks).values({
    leagueId,
    userId,
    espnLeagueId: String(1000 + ++seq),
    espnTeamId: 1,
    season: 2026,
    lastViewedAt: viewedDaysAgo === null ? null : new Date(NOW.getTime() - viewedDaysAgo * DAY),
  });
  return leagueId;
}

const pass = (leagueId: string, userId: string) => grantEntitlement(db, { leagueId, userId, kind: SEASON_PASS, source: "cs_test", amountTotal: 999, currency: "usd" });

describe("runSundayJob", () => {
  let sent: { to: string; email: SeasonEmail; headers: Record<string, string> }[];
  let loads: Map<string, SeasonViewLoad>;
  let deps: SundayDeps;
  let errors: { mock: { calls: unknown[][] } };
  let ids: Record<string, string>;
  let users: Record<string, string>;

  beforeEach(async () => {
    // Each test gets its own users and leagues; earlier tests' leagues show up only as other users.
    await db.delete(espnSeasonLinks);
    sent = [];
    loads = new Map();
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
    deps = {
      model: createFakePlanModel(() => ({ json: { intro: "Start the bench back.", calls: [] }, usage: { inputTokens: 800, outputTokens: 90 } })),
      loadView: async (_userId, leagueId) => loads.get(leagueId) ?? ok,
      sendEmail: async (to, email, headers) => void sent.push({ to, email, headers }),
      paymentsEnabled: true,
      allowlist: [],
      baseUrl: "https://draftroom.example",
      secret: "test-secret",
      now: NOW,
    };
    users = {};
    for (const name of ["alice", "bob", "carol", "dave"]) users[name] = await createTestUser(db, `${name}-${crypto.randomUUID()}@example.test`);
    ids = {
      // Alice is in week 2 of her trial: both her leagues get lineups, in one email.
      alice1: await link(users.alice, "Alice home", 1),
      alice2: await link(users.alice, "Alice work", 3),
      // Bob never asked for AI: his trial hasn't started, and the job doesn't start it.
      bob: await link(users.bob, "Bob league", 1),
      // Carol paid for one league, and left the other alone for three weeks.
      carol: await link(users.carol, "Carol paid", 2),
      carolIdle: await link(users.carol, "Carol idle", 21),
      // Dave's ESPN login lapsed.
      dave: await link(users.dave, "Dave league", 1),
    };
    await startTrial(db, users.alice, 2026, 4);
    await pass(ids.carol, users.carol);
    await pass(ids.carolIdle, users.carol);
    await pass(ids.dave, users.dave);
    loads.set(ids.dave, { kind: "disconnected" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes for paid and trial leagues only, skips an idle one, and sends one email per user", async () => {
    const summary = await runSundayJob(db, deps);
    expect(summary).toEqual({ dryRun: false, leagues: 6, inactive: 1, notEntitled: 1, notConnected: 0, written: 3, existing: 0, failed: 0, emails: 2, reconnects: 1 });

    expect(Object.keys(await findAiLineups(db, ids.alice1, 2026, 5))).toEqual(["lineup-sunday"]);
    expect(await findAiLineups(db, ids.bob, 2026, 5)).toEqual({});
    expect(await findAiLineups(db, ids.carolIdle, 2026, 5)).toEqual({});

    const alice = sent.filter((m) => m.to.startsWith("alice"));
    expect(alice).toHaveLength(1);
    expect(alice[0].email.subject).toBe("Your Sunday lineups are ready (2 leagues)");
    expect(alice[0].email.text).toContain("Alice home (+14.0 pts)\n- Start Bench Back at FLEX\n");
    expect(alice[0].email.text).toContain("https://draftroom.example/season/");
    expect(sent.filter((m) => m.to.startsWith("carol"))[0].email.subject).toBe("Your Sunday lineup is ready");
    expect(sent.filter((m) => m.to.startsWith("dave"))[0].email.subject).toBe("Reconnect ESPN for your Sunday lineup");
    expect(sent.some((m) => m.to.startsWith("bob"))).toBe(false);

    // The unsubscribe link works without signing in, and one-click unsubscribe is offered.
    const url = new URL(alice[0].headers["List-Unsubscribe"].slice(1, -1));
    expect(url.pathname).toBe("/api/season/unsubscribe");
    expect(verifyUnsubscribeToken("test-secret", url.searchParams.get("u")!, url.searchParams.get("t")!)).toBe(true);
  });

  it("changes nothing on a rerun the same morning", async () => {
    await runSundayJob(db, deps);
    sent = [];
    const again = await runSundayJob(db, deps);
    expect(again).toMatchObject({ written: 0, existing: 3, emails: 0, reconnects: 0 });
    expect(sent).toEqual([]);
  });

  it("in a dry run, counts what it would do without calling the model or sending", async () => {
    const summary = await runSundayJob(db, deps, { dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, written: 3, inactive: 1, notEntitled: 1, emails: 0 });
    expect((deps.model as ReturnType<typeof createFakePlanModel>).calls).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("respects an opt-out, and still writes the lineup", async () => {
    await setSeasonEmails(db, users.carol, false);
    const summary = await runSundayJob(db, deps);
    expect(summary.emails).toBe(1);
    expect(sent.some((m) => m.to.startsWith("carol"))).toBe(false);
    expect(Object.keys(await findAiLineups(db, ids.carol, 2026, 5))).toEqual(["lineup-sunday"]);
  });

  it("logs a [server-error] when the model fails, and emails only what was written", async () => {
    deps.model = createFakePlanModel(() => {
      throw new PlanModelError("unavailable", "down");
    });
    const summary = await runSundayJob(db, deps);
    expect(summary).toMatchObject({ written: 0, failed: 3, emails: 0, reconnects: 1 });
    expect(errors.mock.calls.filter((call) => String(call[0]).startsWith("[server-error]"))).toHaveLength(3);
  });
});
