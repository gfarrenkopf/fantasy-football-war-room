import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { parseAlertChanges, resolveAlerts } from "@/lib/season/alerts";
import type { SeasonEmail } from "@/lib/season/email";
import { createAppSession } from "./appAuth";
import { registerDevice } from "./devices";
import { notify } from "./notify";
import type { PushAlert } from "./push";
import type { JobMail } from "./seasonJobs";
import { alertChannels, setAlertChannels, setSeasonEmails, unsubscribe, unsubscribeToken } from "./seasonPrefs";

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

const hex = () => crypto.randomUUID().replaceAll("-", "").repeat(2);
async function withPhone(userId: string) {
  const { token } = await createAppSession(db, userId);
  await registerDevice(db, userId, token, { token: hex(), environment: "production", appVersion: "1.0" });
}

describe("resolveAlerts", () => {
  it("defaults to email without the app, and email and push with it", () => {
    expect(resolveAlerts({}, { seasonEmails: true, hasDevice: false })).toEqual({ lineup: "email", kickoff: "email", reminder: "off", live: "off", reconnect: "email", draft: "email" });
    expect(resolveAlerts({ draft: "off" }, { seasonEmails: true, hasDevice: true })).toEqual({ lineup: "both", kickoff: "both", reminder: "push", live: "off", reconnect: "both", draft: "off" });
  });

  it("takes email out of untouched alerts when season emails were turned off the old way", () => {
    expect(resolveAlerts({ lineup: "email" }, { seasonEmails: false, hasDevice: false })).toEqual({ lineup: "email", kickoff: "off", reminder: "off", live: "off", reconnect: "off", draft: "off" });
    expect(resolveAlerts({}, { seasonEmails: false, hasDevice: true }).kickoff).toBe("push");
  });

  it("parses changes, refusing unknown alerts and channels", () => {
    expect(parseAlertChanges({ alerts: { kickoff: "push", draft: "off" } })).toEqual({ kickoff: "push", draft: "off" });
    expect(parseAlertChanges({ alerts: { kickoff: "sms" } })).toBeNull();
    expect(parseAlertChanges({ alerts: { weather: "push" } })).toBeNull();
    expect(parseAlertChanges({ alerts: {} })).toBeNull();
    // The reminder is push-only: there's no email to choose.
    expect(parseAlertChanges({ alerts: { reminder: "both" } })).toBeNull();
    expect(parseAlertChanges({ alerts: { reminder: "push" } })).toEqual({ reminder: "push" });
    expect(parseAlertChanges(null)).toBeNull();
  });
});

describe("alert preferences", () => {
  it("keeps earlier choices when saving others", async () => {
    const userId = await createTestUser(db);
    await setAlertChannels(db, userId, { kickoff: "push" });
    await setAlertChannels(db, userId, { draft: "off" });
    expect(await alertChannels(db, userId)).toMatchObject({ kickoff: "push", draft: "off", lineup: "email" });
  });

  it("turns off one alert's email from its link, and every alert's from an old link", async () => {
    const one = await createTestUser(db);
    await withPhone(one);
    await unsubscribe(db, one, "lineup");
    expect(await alertChannels(db, one)).toEqual({ lineup: "push", kickoff: "both", reminder: "push", live: "off", reconnect: "both", draft: "both" });

    const all = await createTestUser(db);
    await setAlertChannels(db, all, { kickoff: "both" });
    await unsubscribe(db, all, null);
    expect(await alertChannels(db, all)).toEqual({ lineup: "off", kickoff: "push", reminder: "off", live: "off", reconnect: "off", draft: "off" });
    // Untouched alerts still gain push when the app arrives.
    await withPhone(all);
    expect(await alertChannels(db, all)).toEqual({ lineup: "push", kickoff: "push", reminder: "push", live: "off", reconnect: "push", draft: "push" });
  });
});

describe("notify", () => {
  const email: SeasonEmail = { subject: "Your Sunday lineup is ready", html: "<p>hi</p>", text: "hi" };
  const push: PushAlert = { title: "Your Sunday lineup is ready", body: "League: start Puka" };
  let emails: string[];
  let pushes: string[];
  let deps: JobMail;
  const now = new Date("2026-10-11T15:40:00Z");
  beforeEach(() => {
    emails = [];
    pushes = [];
    deps = {
      sendEmail: async (to) => void emails.push(to),
      sendPush: async (userId) => {
        pushes.push(userId);
        return { sent: 1, removed: 0, failed: 0 };
      },
      baseUrl: "https://draftroom.test",
      secret: "secret",
    };
  });
  const send = (userId: string, to: string | null = "fan@example.test") => notify(db, deps, { job: "sunday", userId, to, kind: "lineup", now }, { email, push });

  it("emails a user without the app, exactly as before, once a day", async () => {
    const userId = await createTestUser(db);
    let headers: Record<string, string> = {};
    deps.sendEmail = async (to, _email, h) => {
      emails.push(to);
      headers = h;
    };
    expect(await send(userId)).toEqual({ email: true, push: 0 });
    expect(await send(userId)).toEqual({ email: false, push: 0 });
    expect(emails).toEqual(["fan@example.test"]);
    expect(pushes).toEqual([]);
    const oneClick = new URL(headers["List-Unsubscribe"].slice(1, -1));
    expect(oneClick.pathname).toBe("/api/season/unsubscribe");
    expect(Object.fromEntries(oneClick.searchParams)).toEqual({ u: userId, t: unsubscribeToken("secret", userId), k: "lineup" });
  });

  it("emails and pushes once the user has the app, and follows their choice", async () => {
    const both = await createTestUser(db);
    await withPhone(both);
    expect(await send(both)).toEqual({ email: true, push: 1 });

    const pushOnly = await createTestUser(db);
    await setAlertChannels(db, pushOnly, { lineup: "push" });
    expect(await send(pushOnly, null)).toEqual({ email: false, push: 1 });

    const off = await createTestUser(db);
    await setAlertChannels(db, off, { lineup: "off" });
    expect(await send(off)).toEqual({ email: false, push: 0 });
    expect(emails).toEqual(["fan@example.test"]);
    expect(pushes).toEqual([both, pushOnly]);
  });

  it("skips a channel the server can't send, and lets a rerun retry when nothing went out", async () => {
    const userId = await createTestUser(db);
    await setAlertChannels(db, userId, { lineup: "push" });
    deps.sendPush = async () => ({ sent: 0, removed: 1, failed: 0 });
    expect(await send(userId)).toEqual({ email: false, push: 0 });
    deps.sendPush = async () => ({ sent: 1, removed: 0, failed: 0 });
    expect(await send(userId)).toEqual({ email: false, push: 1 });
    deps.sendPush = null;
    const legacyOff = await createTestUser(db);
    await setSeasonEmails(db, legacyOff, false);
    await withPhone(legacyOff);
    expect(await send(legacyOff)).toEqual({ email: false, push: 0 });
  });
});

describe("/api/v1/notifications and the unsubscribe link", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [name, value] of Object.entries({ DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", AUTH_RESEND_KEY: "re_x", EMAIL_FROM: "a@b.test" })) vi.stubEnv(name, value);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads and changes the user's alerts", async () => {
    const userId = await createTestUser(db, `${crypto.randomUUID()}@example.test`);
    state.user = { userId, email: null };
    const { GET, PUT } = await import("@/app/api/v1/notifications/route");
    const res = await GET(new Request("http://localhost/api/v1/notifications"), undefined as never);
    expect(await res.json()).toEqual({
      alerts: [
        { kind: "lineup", title: "Sunday AI lineup", detail: "When your Sunday lineup is ready.", channel: "email", pushOnly: false },
        { kind: "kickoff", title: "Before kickoff", detail: expect.any(String), channel: "email", pushOnly: false },
        { kind: "reminder", title: "Lineup reminder", detail: expect.any(String), channel: "off", pushOnly: true },
        { kind: "live", title: "Follow live", detail: expect.any(String), channel: "off", pushOnly: true },
        { kind: "reconnect", title: "ESPN reconnect", detail: expect.any(String), channel: "email", pushOnly: false },
        { kind: "draft", title: "Draft day", detail: expect.any(String), channel: "email", pushOnly: false },
      ],
      email: true,
      push: false,
      hasDevice: false,
    });
    const put = (body: unknown) =>
      PUT(new Request("http://localhost/api/v1/notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), undefined as never);
    const changed = await put({ alerts: { draft: "off" } });
    expect((await changed.json()).alerts[5]).toMatchObject({ kind: "draft", channel: "off" });
    expect((await put({ alerts: { draft: "loud" } })).status).toBe(400);
  });

  it("turns off the named alert's email from a link", async () => {
    const userId = await createTestUser(db);
    const { POST } = await import("@/app/api/season/unsubscribe/route");
    const url = `http://localhost/api/season/unsubscribe?u=${userId}&t=${unsubscribeToken("secret", userId)}&k=kickoff`;
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(204);
    expect(await alertChannels(db, userId)).toEqual({ lineup: "email", kickoff: "off", reminder: "off", live: "off", reconnect: "email", draft: "email" });
    expect((await POST(new Request(url.replace(/t=[^&]+/, "t=nope"), { method: "POST" }))).status).toBe(400);
  });
});
