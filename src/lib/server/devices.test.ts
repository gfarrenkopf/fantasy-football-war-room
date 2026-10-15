import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceTokens, users } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { createAppSession, deleteAppSession } from "./appAuth";
import { devicesFor, parseRegistration, registerDevice, removeDevice } from "./devices";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ db: null as unknown, cookieUser: null as { userId: string; email: string | null } | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.cookieUser, authjs: null }));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const hex = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
const rows = (token: string) => db.select().from(deviceTokens).where(eq(deviceTokens.token, token));

async function signedIn(email?: string) {
  const userId = await createTestUser(db, email);
  const { token } = await createAppSession(db, userId);
  return { userId, session: token };
}

describe("parseRegistration", () => {
  it("lowercases the token and keeps the fields", () => {
    expect(parseRegistration({ token: "AB".repeat(32), environment: "sandbox", appVersion: "1.0" })).toEqual({
      ok: true,
      value: { token: "ab".repeat(32), environment: "sandbox", appVersion: "1.0" },
    });
  });

  it("rejects a token that isn't hex, and an unknown environment", () => {
    expect(parseRegistration({ token: "not-a-token", environment: "sandbox" }).ok).toBe(false);
    expect(parseRegistration({ token: "ab".repeat(32), environment: "staging" }).ok).toBe(false);
    expect(parseRegistration(null).ok).toBe(false);
  });
});

describe("device tokens", () => {
  it("registers once and refreshes on the next launch", async () => {
    const { userId, session } = await signedIn();
    const token = hex();
    await registerDevice(db, userId, session, { token, environment: "sandbox", appVersion: "1.0" }, new Date("2026-10-01T00:00:00Z"));
    await registerDevice(db, userId, session, { token, environment: "sandbox", appVersion: "1.1" }, new Date("2026-10-08T00:00:00Z"));
    const [row] = await rows(token);
    expect(row).toMatchObject({ userId, appVersion: "1.1", createdAt: new Date("2026-10-01T00:00:00Z"), lastSeenAt: new Date("2026-10-08T00:00:00Z") });
    expect(await devicesFor(db, userId)).toEqual([{ token, environment: "sandbox" }]);
  });

  it("moves a token to the account that registers it next", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const token = hex();
    await registerDevice(db, a.userId, a.session, { token, environment: "production", appVersion: "1.0" });
    await registerDevice(db, b.userId, b.session, { token, environment: "production", appVersion: "1.0" });
    expect(await devicesFor(db, a.userId)).toEqual([]);
    expect(await devicesFor(db, b.userId)).toEqual([{ token, environment: "production" }]);
  });

  it("removes only the user's own token", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const token = hex();
    await registerDevice(db, a.userId, a.session, { token, environment: "sandbox", appVersion: "" });
    await removeDevice(db, b.userId, token);
    expect(await rows(token)).toHaveLength(1);
    await removeDevice(db, a.userId, token.toUpperCase());
    expect(await rows(token)).toEqual([]);
  });

  it("goes with the session on sign-out, stops on an expired session, and goes with the user", async () => {
    const { userId, session } = await signedIn();
    const signedOut = hex();
    await registerDevice(db, userId, session, { token: signedOut, environment: "sandbox", appVersion: "" });
    await deleteAppSession(db, session);
    expect(await rows(signedOut)).toEqual([]);

    const old = await createAppSession(db, userId, new Date("2020-01-01T00:00:00Z"));
    const expired = hex();
    await registerDevice(db, userId, old.token, { token: expired, environment: "sandbox", appVersion: "" });
    expect(await devicesFor(db, userId)).toEqual([]);

    await db.delete(users).where(eq(users.id, userId));
    expect(await rows(expired)).toEqual([]);
  });
});

describe("/api/v1/devices", () => {
  beforeEach(() => {
    vi.resetModules();
    state.cookieUser = null;
    for (const [name, value] of Object.entries({ DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret" })) vi.stubEnv(name, value);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const register = async (body: unknown, headers: Record<string, string>) => {
    const { POST } = await import("@/app/api/v1/devices/route");
    return POST(new Request("http://localhost/api/v1/devices", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), undefined as never);
  };
  const unregister = async (token: string, headers: Record<string, string>) => {
    const { DELETE } = await import("@/app/api/v1/devices/[token]/route");
    return DELETE(new Request(`http://localhost/api/v1/devices/${token}`, { method: "DELETE", headers }), { params: Promise.resolve({ token }) });
  };

  it("registers and deletes with the app's Bearer session", async () => {
    const { userId, session } = await signedIn();
    const auth = { authorization: `Bearer ${session}` };
    const token = hex();
    expect((await register({ token, environment: "sandbox", appVersion: "1.0" }, auth)).status).toBe(204);
    expect(await devicesFor(db, userId)).toEqual([{ token, environment: "sandbox" }]);
    expect((await unregister(token, auth)).status).toBe(204);
    expect(await devicesFor(db, userId)).toEqual([]);
  });

  it("is 400 for a bad body, 400 from a web cookie, and 401 signed out", async () => {
    const { userId, session } = await signedIn();
    expect((await register({ token: "x", environment: "sandbox" }, { authorization: `Bearer ${session}` })).status).toBe(400);
    expect((await register({ token: hex(), environment: "sandbox" }, {})).status).toBe(401);
    state.cookieUser = { userId, email: null };
    expect((await register({ token: hex(), environment: "sandbox" }, {})).status).toBe(400);
  });
});
