import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { deviceTokens, espnSeasonLinks, liveActivities } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { LiveMatchup } from "@/lib/season/liveMatchup";
import type { GameState } from "@/lib/season/scoreboard";
import type { SeasonView } from "@/lib/season/view";
import type { ApnsClient, ApnsMessage, ApnsOutcome } from "./apns";
import { createAppSession } from "./appAuth";
import { registerDevice } from "./devices";
import type { SeasonViewLoad } from "./espn/seasonView";
import { livePayload, nextSend, registerLiveActivity, runLiveJob, type LiveDeps } from "./liveActivities";
import { setAlertChannels } from "./seasonPrefs";
import { createTestLeague } from "./testLeagues";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ db: null as unknown, user: null as { userId: string; email: string | null } | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const NOW = new Date("2026-10-11T18:30:00Z"); // Sunday, 1 PM games on
const game = (s: GameState["state"]): GameState => ({ state: s, detail: "", opponent: "NYJ", home: true, kickoff: "2026-10-11T17:00:00Z", period: 2, clockSeconds: 300, score: null });

/** The user's QB against theirs, both games in `s`, scoring `mine` to `theirs`. */
function matchupView(mine: number, theirs: number, s: GameState["state"] = "in"): SeasonView {
  const view = seasonView([at("QB", player("My QB", "QB", 19, { game: game(s), actual: mine }))], [at("QB", player("Their QB", "QB", 18, { game: game(s), actual: theirs }))]);
  const sides = { home: { teamId: 1, points: mine, projected: 20, winProbability: 0.6 }, away: { teamId: 2, points: theirs, projected: 18, winProbability: 0.4 } };
  return { ...view, matchups: [sides], matchup: { me: sides.home, them: sides.away } };
}
const ok = (view: SeasonView): SeasonViewLoad => ({ kind: "ok", view, fetchedAt: NOW, stale: false, projectionsMissing: false, phase: "live" } as SeasonViewLoad);

const side = (points: number) => ({ teamId: 1, name: "Mine", points, projected: 20, left: 1 });
const live = (me: number, them: number, decided = false): LiveMatchup => ({ week: 5, status: "Live", live: !decided, started: true, decided, lead: me - them, win: 60, me: side(me), them: { ...side(them), teamId: 2 } });

const hex = () => crypto.randomUUID().replaceAll("-", "").repeat(2);

/** An APNs client that records what it was asked to send, answering `reply`. */
function fakeApns(reply: (token: string) => ApnsOutcome = () => ({ kind: "sent" })) {
  const sent: { token: string; message: ApnsMessage }[] = [];
  const apns: ApnsClient = {
    async send(device, message) {
      sent.push({ token: device.token, message });
      return reply(device.token);
    },
  };
  return { sent, apns };
}

describe("livePayload and nextSend", () => {
  it("builds update, end and start payloads", () => {
    const s = live(10, 8);
    expect(livePayload("update", s, NOW)).toEqual({ aps: { timestamp: NOW.getTime() / 1000, event: "update", "content-state": s, "stale-date": NOW.getTime() / 1000 + 600 } });
    expect(livePayload("end", s, NOW).aps).toMatchObject({ event: "end", "dismissal-date": NOW.getTime() / 1000 + 7200 });
    expect(livePayload("start", s, NOW, { attributes: { leagueId: "lg", league: "L" }, alert: { title: "L is live", body: "Live" } }).aps).toMatchObject({
      event: "start",
      "attributes-type": "GameDayAttributes",
      attributes: { leagueId: "lg", league: "L" },
      alert: { title: "L is live", body: "Live" },
    });
  });

  it("sends only a change, at most once a minute, and always the final", () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    expect(nextSend(null, null, live(0, 0), NOW)).toEqual({ send: true, priority: 10, end: false });
    expect(nextSend(live(10, 8), NOW, live(10, 8), at(5 * 60_000))).toEqual({ send: false });
    expect(nextSend(live(10, 8), NOW, live(12, 8), at(30_000))).toEqual({ send: false });
    expect(nextSend(live(10, 8), NOW, live(12, 8), at(60_000))).toEqual({ send: true, priority: 10, end: false });
    expect(nextSend(live(10, 8), NOW, { ...live(10, 8), status: "3 left for Theirs" }, at(60_000))).toEqual({ send: true, priority: 5, end: false });
    expect(nextSend(live(10, 8), NOW, live(10, 8, true), at(1))).toEqual({ send: true, priority: 10, end: true });
  });
});

describe("runLiveJob", () => {
  let views: Map<string, SeasonView>;
  let deps: LiveDeps;
  beforeEach(async () => {
    await db.delete(liveActivities);
    await db.delete(espnSeasonLinks);
    views = new Map();
    deps = { loadView: async (_u, leagueId) => ok(views.get(leagueId)!), apns: fakeApns().apns, bundleId: "tech.apeman.draftroom", now: NOW };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  async function following(view: SeasonView, week = 5) {
    const userId = await createTestUser(db);
    const { token: session } = await createAppSession(db, userId);
    const leagueId = await createTestLeague(db, userId, "Sunday League");
    views.set(leagueId, view);
    const token = hex();
    await registerLiveActivity(db, { userId, sessionToken: session, leagueId, token, environment: "production", week });
    return { userId, session, leagueId, token };
  }
  const row = async (token: string) => (await db.select().from(liveActivities).where(eq(liveActivities.token, token)))[0];

  it("pushes the score to the activity's topic, then waits for a change", async () => {
    const { token } = await following(matchupView(12.5, 8));
    const { sent, apns } = fakeApns();
    expect(await runLiveJob(db, { ...deps, apns })).toMatchObject({ activities: 1, updated: 1, ended: 0 });
    expect(sent[0]).toMatchObject({ token, message: { pushType: "liveactivity", topic: "tech.apeman.draftroom.push-type.liveactivity", priority: 10 } });
    const pushed = (sent[0].message.payload as { aps: { "content-state": LiveMatchup } }).aps["content-state"];
    expect(pushed).toMatchObject({ week: 5, live: true, started: true, decided: false, lead: 4.5, win: 60, me: { name: "Mine", points: 12.5 }, them: { name: "Theirs", points: 8 } });
    expect((await row(token)).state).toEqual(pushed);

    // Nothing new a minute later: nothing sent.
    expect(await runLiveJob(db, { ...deps, apns, now: new Date(NOW.getTime() + 90_000) })).toMatchObject({ updated: 0 });
    expect(sent).toHaveLength(1);
  });

  it("ends the activity once the week is decided, and stops", async () => {
    const { token, leagueId } = await following(matchupView(30, 20, "post"));
    const { sent, apns } = fakeApns();
    expect(await runLiveJob(db, { ...deps, apns })).toMatchObject({ ended: 1 });
    expect((sent[0].message.payload as { aps: { event: string } }).aps.event).toBe("end");
    expect((await row(token)).endedAt).toEqual(NOW);
    views.set(leagueId, matchupView(31, 20, "post"));
    expect(await runLiveJob(db, { ...deps, apns })).toMatchObject({ activities: 0 });
  });

  it("ends on the last score when ESPN has moved to the next week, and forgets a dead token", async () => {
    const old = await following(matchupView(20, 10), 4);
    await db.update(liveActivities).set({ state: live(20, 10), sentAt: NOW }).where(eq(liveActivities.token, old.token));
    const dead = await following(matchupView(5, 5));
    const { sent, apns } = fakeApns((token) => (token === dead.token ? { kind: "dead", reason: "Unregistered" } : { kind: "sent" }));
    expect(await runLiveJob(db, { ...deps, apns })).toMatchObject({ ended: 1 });
    expect(sent.find((s) => s.token === old.token)?.message.payload).toMatchObject({ aps: { event: "end", "content-state": live(20, 10) } });
    expect(await row(dead.token)).toBeUndefined();
  });

  it("does nothing when push is off", async () => {
    await following(matchupView(1, 1));
    expect(await runLiveJob(db, { ...deps, apns: null })).toMatchObject({ activities: 0, updated: 0 });
  });

  describe("push-to-start", () => {
    const schedule = new Map([[5, new Map([["DET", Date.parse("2026-10-11T17:00:00Z")]])]]);
    async function fan({ follow }: { follow: boolean }) {
      const userId = await createTestUser(db);
      const { token: session } = await createAppSession(db, userId);
      const start = hex();
      await registerDevice(db, userId, session, { token: hex(), environment: "production", appVersion: "1.0", startToken: start });
      if (follow) await setAlertChannels(db, userId, { live: "push" });
      const leagueId = await createTestLeague(db, userId, "Fan League");
      await db.insert(espnSeasonLinks).values({ leagueId, userId, espnLeagueId: String(Math.random()), espnTeamId: 1, season: 2026, lastViewedAt: NOW });
      views.set(leagueId, matchupView(3, 0));
      return { userId, leagueId, start };
    }

    it("starts one when the user's matchup kicks off, if they turned Follow live on, once a week", async () => {
      const on = await fan({ follow: true });
      await fan({ follow: false });
      const { sent, apns } = fakeApns();
      expect(await runLiveJob(db, { ...deps, apns, schedule })).toMatchObject({ started: 1 });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        token: on.start,
        message: { payload: { aps: { event: "start", "attributes-type": "GameDayAttributes", attributes: { leagueId: on.leagueId, league: "Fan League" }, alert: { title: "Fan League is live" } } } },
      });
      expect(await runLiveJob(db, { ...deps, apns, schedule, now: new Date(NOW.getTime() + 60_000) })).toMatchObject({ started: 0 });
    });

    it("waits for a game to be on, and forgets a dead start token", async () => {
      const on = await fan({ follow: true });
      const { sent, apns } = fakeApns(() => ({ kind: "dead", reason: "BadDeviceToken" }));
      expect(await runLiveJob(db, { ...deps, apns, schedule, now: new Date("2026-10-10T18:00:00Z") })).toMatchObject({ started: 0 });
      expect(sent).toEqual([]);
      await runLiveJob(db, { ...deps, apns, schedule });
      const [device] = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, on.userId));
      expect(device.startToken).toBeNull();
    });
  });
});

describe("/api/v1/leagues/:id/live-activity", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [name, value] of Object.entries({ DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "" })) vi.stubEnv(name, value);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("registers the app's activity for the user's league, and removes it", async () => {
    const userId = await createTestUser(db);
    const { token: session } = await createAppSession(db, userId);
    const leagueId = await createTestLeague(db, userId);
    const auth = { authorization: `Bearer ${session}`, "content-type": "application/json" };
    const { POST } = await import("@/app/api/v1/leagues/[id]/live-activity/route");
    const { DELETE } = await import("@/app/api/v1/leagues/[id]/live-activity/[token]/route");
    const post = (id: string, body: unknown) => POST(new Request(`http://localhost/api/v1/leagues/${id}/live-activity`, { method: "POST", headers: auth, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    const token = hex();
    expect((await post(leagueId, { token, environment: "sandbox", week: 5 })).status).toBe(204);
    expect(await db.select({ week: liveActivities.week }).from(liveActivities).where(eq(liveActivities.token, token))).toEqual([{ week: 5 }]);
    expect((await post(leagueId, { token, environment: "sandbox" })).status).toBe(400);
    expect((await post("someone-elses", { token, environment: "sandbox", week: 5 })).status).toBe(404);
    const del = await DELETE(new Request(`http://localhost/x`, { method: "DELETE", headers: auth }), { params: Promise.resolve({ id: leagueId, token }) });
    expect(del.status).toBe(204);
    expect(await db.select().from(liveActivities).where(eq(liveActivities.token, token))).toEqual([]);
  });
});
