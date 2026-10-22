import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceTokens } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import { deleteAccount } from "./account";
import { createAppSession, userForEmail } from "./appAuth";
import type { ApnsClient } from "./apns";
import { registerDevice } from "./devices";
import { listSeasonLinks } from "./espn/seasonLinks";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ db: null as unknown, signIn: vi.fn(), apns: null as ApnsClient | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => null, authjs: { signIn: state.signIn } }));
vi.mock("./push", async (original) => ({ ...(await original<typeof import("./push")>()), apnsClient: () => state.apns }));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const REVIEW = "Review@Example.test";
const CODE = "apple-review-1234";
const SWID = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}";
const ENV = {
  DATABASE_URL: "postgres://localhost/unused",
  NEXTAUTH_SECRET: "secret",
  AUTH_RESEND_KEY: "re_test",
  EMAIL_FROM: "Draft Room <hi@example.test>",
  ESPN_CODE_KEY: randomBytes(32).toString("base64"),
  REVIEW_ACCOUNT_EMAIL: REVIEW,
  REVIEW_ACCOUNT_CODE: CODE,
};

beforeEach(() => {
  vi.resetModules();
  state.signIn.mockReset();
  state.apns = null;
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  for (const name of ["REVIEW_ESPN_S2", "REVIEW_ESPN_SWID", "REVIEW_ESPN_LEAGUES", "AI_ALLOWLIST", "SEASON_ALLOWLIST", "ESPN_SYNC_ALLOWLIST", "STRIPE_SECRET_KEY"]) vi.stubEnv(name, "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The account for an email, made the first time: the review account's is shared by every test. */
const account = async (email: string) => (await userForEmail(db, email)).userId;

let ip = 0;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}`, ...headers },
    body: JSON.stringify(body),
  });
const start = async (email: string) => (await import("@/app/api/v1/auth/email/start/route")).POST(post("/api/v1/auth/email/start", { email }));
const code = async (email: string, value: string) => (await import("@/app/api/v1/auth/email/code/route")).POST(post("/api/v1/auth/email/code", { email, code: value }));

describe("POST /api/v1/auth/email/start", () => {
  it("asks for the code for the review account, sending no mail", async () => {
    const res = await start("  review@example.TEST ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ step: "code" });
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it("sends every other address its magic link, as before", async () => {
    const res = await start("someone@example.test");
    expect(res.status).toBe(204);
    expect(state.signIn).toHaveBeenCalledWith("resend", expect.objectContaining({ email: "someone@example.test" }));
  });

  it("never asks for a code with the review account off", async () => {
    vi.stubEnv("REVIEW_ACCOUNT_CODE", "");
    expect((await start(REVIEW)).status).toBe(204);
    expect(state.signIn).toHaveBeenCalled();
  });
});

describe("POST /api/v1/auth/email/code", () => {
  it("signs the review account in with its code, whatever the email's case", async () => {
    const res = await code("REVIEW@example.test", CODE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("review@example.test");
    expect(typeof body.token).toBe("string");
    // Same account the second time.
    const again = await (await code(REVIEW, CODE)).json();
    expect(again).toMatchObject({ isNew: false, user: { id: body.user.id } });
  });

  it("refuses a wrong code, and the right code for any other email", async () => {
    expect((await code(REVIEW, "apple-review-0000")).status).toBe(401);
    expect((await code("someone@example.test", CODE)).status).toBe(401);
    expect((await code("review@example.test.evil", CODE)).status).toBe(401);
  });

  it("is off when the review variables are unset, or the code is too short", async () => {
    vi.stubEnv("REVIEW_ACCOUNT_EMAIL", "");
    expect((await code(REVIEW, CODE)).status).toBe(401);
    vi.resetModules();
    vi.stubEnv("REVIEW_ACCOUNT_EMAIL", REVIEW);
    vi.stubEnv("REVIEW_ACCOUNT_CODE", "short");
    expect((await code(REVIEW, "short")).status).toBe(401);
  });

  it("allows five tries per email, from any address", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await code("Limited@example.test", `guess-${i}`)).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});

describe("config", () => {
  it("adds the reviewer to allowlists in use, never to an empty one that means everyone", async () => {
    vi.stubEnv("AI_ALLOWLIST", "greg@example.test");
    vi.stubEnv("SEASON_ALLOWLIST", "");
    const { config } = await import("@/lib/config");
    expect(config.aiAllowlist).toEqual(["greg@example.test", "review@example.test"]);
    expect(config.seasonAllowlist).toEqual(["review@example.test"]);
    expect(config.espnSyncAllowlist).toEqual([]);
  });

  it("warns about a partial setup", async () => {
    vi.stubEnv("REVIEW_ACCOUNT_CODE", "");
    vi.stubEnv("REVIEW_ESPN_S2", "AEB");
    await import("@/lib/config");
    const warned = vi.mocked(console.warn).mock.calls.map(([line]) => String(line));
    expect(warned).toContain("[config] Only one of REVIEW_ACCOUNT_EMAIL and REVIEW_ACCOUNT_CODE is set, so the App Review account is off.");
    expect(warned).toContain("[config] REVIEW_ESPN_SWID is not set, so the App Review account gets no ESPN leagues.");
  });
});

describe("ensureReviewSetup", () => {
  const fan = (groupId: number, name: string) => ({ typeId: 9, metaData: { entry: { abbrev: "FFL", seasonId: 2026, entryId: 3, groups: [{ groupId, groupName: name }] } } });
  const preferences = [fan(110222051, "App Test 8.17"), fan(704343562, "App Tester"), { typeId: 9, metaData: { entry: { abbrev: "FFL", seasonId: 2025, entryId: 1, groups: [{ groupId: 111, groupName: "Old" }] } } }];
  const espn = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("fan.api.espn.com")
      ? Response.json({ preferences })
      : Response.json({ settings: league.settings, teams: [{ id: 3, owners: [SWID.toLowerCase()] }] }),
  );

  beforeEach(() => {
    vi.stubEnv("REVIEW_ESPN_S2", "AEB%2Fnot-real");
    vi.stubEnv("REVIEW_ESPN_SWID", SWID);
  });

  it("connects the test account's leagues this season, once, and again after the account is deleted", async () => {
    const { ensureReviewSetup } = await import("./reviewAccount");
    const userId = await account("review@example.test");
    await deleteAccount(db, userId);
    const fresh = await account("review@example.test");
    expect(await ensureReviewSetup(db, fresh, { fetchImpl: espn })).toEqual({ ok: true, connected: ["110222051", "704343562"], kept: [] });
    expect((await listSeasonLinks(db, fresh)).map((l) => l.espnLeagueId).sort()).toEqual(["110222051", "704343562"]);
    expect(await ensureReviewSetup(db, fresh, { fetchImpl: espn })).toEqual({ ok: true, connected: [], kept: ["110222051", "704343562"] });

    await deleteAccount(db, fresh);
    const again = await account("review@example.test");
    expect(await ensureReviewSetup(db, again, { fetchImpl: espn })).toMatchObject({ ok: true, connected: ["110222051", "704343562"] });
  });

  it("connects only REVIEW_ESPN_LEAGUES when it's set", async () => {
    vi.stubEnv("REVIEW_ESPN_LEAGUES", "704343562");
    const { ensureReviewSetup } = await import("./reviewAccount");
    const userId = await createTestUser(db);
    expect(await ensureReviewSetup(db, userId, { fetchImpl: espn })).toEqual({ ok: true, connected: ["704343562"], kept: [] });
  });

  it("says why when ESPN refuses the test account", async () => {
    const { ensureReviewSetup } = await import("./reviewAccount");
    const refused = vi.fn<typeof fetch>(async () => new Response("", { status: 401 }));
    expect(await ensureReviewSetup(db, await createTestUser(db), { fetchImpl: refused })).toMatchObject({ ok: false, error: expect.stringContaining("REVIEW_ESPN_S2") });
  });
});

describe("GET /api/v1/me", () => {
  it("marks only the review account", async () => {
    const { GET } = await import("@/app/api/v1/me/route");
    const me = async (email: string) => {
      const { token } = await createAppSession(db, await account(email));
      return (await GET(new Request("http://localhost/api/v1/me", { headers: { authorization: `Bearer ${token}` } }), undefined as never)).json();
    };
    expect(await me("review@example.test")).toMatchObject({ review: true });
    expect(await me("someone-else@example.test")).not.toHaveProperty("review");
  });
});

describe("POST /api/v1/review/sample", () => {
  const sample = async (email: string, kind: string, startToken: string | null = "start-token") => {
    const userId = await account(email);
    const { token } = await createAppSession(db, userId);
    await registerDevice(db, userId, token, { token: `device-${token}`, environment: "sandbox", appVersion: "1.0", startToken });
    const { POST } = await import("@/app/api/v1/review/sample/route");
    return POST(post("/api/v1/review/sample", { kind }, { authorization: `Bearer ${token}` }), undefined as never);
  };
  const apns = () => {
    const send = vi.fn<ApnsClient["send"]>(async () => ({ kind: "sent" }) as Awaited<ReturnType<ApnsClient["send"]>>);
    state.apns = { send } as unknown as ApnsClient;
    return send;
  };

  it("is 404 for every other account", async () => {
    const send = apns();
    expect((await sample("someone@example.test", "alert")).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the reviewer a sample alert, and starts a sample Live Activity", async () => {
    const send = apns();
    expect((await sample("review@example.test", "alert")).status).toBe(200);
    expect(send.mock.calls[0][1]).toMatchObject({ pushType: "alert" });

    expect((await sample("review@example.test", "live")).status).toBe(200);
    const live = send.mock.calls.at(-1)!;
    expect(live[0]).toMatchObject({ token: "start-token" });
    expect(live[1]).toMatchObject({ pushType: "liveactivity", topic: "tech.apeman.draftroom.push-type.liveactivity" });
    expect((live[1].payload as { aps: { event: string } }).aps.event).toBe("start");
  });

  it("explains when the phone can't start a Live Activity", async () => {
    apns();
    await db.delete(deviceTokens).where(eq(deviceTokens.userId, await account("review@example.test")));
    expect((await sample("review@example.test", "live", null)).status).toBe(409);
  });
});
