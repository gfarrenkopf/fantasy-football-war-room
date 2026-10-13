import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { createAppSession, createHandoffCode } from "./appAuth";

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

beforeEach(() => {
  vi.resetModules();
  state.cookieUser = null;
  for (const [name, value] of Object.entries({ DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_SYNC_ALLOWLIST: "" })) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const me = async (headers: Record<string, string> = {}) => {
  const { GET } = await import("@/app/api/v1/me/route");
  return GET(new Request("http://localhost/api/v1/me", { headers }), undefined as never);
};
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("withUser with Authorization: Bearer (GET /api/v1/me)", () => {
  it("answers as the token's user, with flags and the minimum app version", async () => {
    const userId = await createTestUser(db, "me@example.test");
    const { token } = await createAppSession(db, userId);
    const res = await me({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      user: { id: userId, email: "me@example.test", name: null },
      flags: { season: false, ai: false, payments: false },
      minAppVersion: "1.0",
    });
  });

  it("is 401 for an expired token", async () => {
    const userId = await createTestUser(db);
    const { token } = await createAppSession(db, userId, new Date("2020-01-01T00:00:00Z"));
    expect((await me({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("is 401 for an unknown token, even with a signed-in cookie", async () => {
    state.cookieUser = { userId: await createTestUser(db), email: null };
    expect((await me({ authorization: "Bearer nope" })).status).toBe(401);
  });

  it("falls back to the cookie session without a token, and is 401 with neither", async () => {
    expect((await me()).status).toBe(401);
    state.cookieUser = { userId: await createTestUser(db), email: null };
    expect((await me()).status).toBe(200);
  });

  it("is 404 with cloud features off", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect((await me({ authorization: "Bearer x" })).status).toBe(404);
  });
});

describe("POST /api/v1/auth/code", () => {
  it("trades a hand-off code for a session, once", async () => {
    const { POST } = await import("@/app/api/v1/auth/code/route");
    const userId = await createTestUser(db, "google@example.test");
    const code = await createHandoffCode(db, userId);
    const first = await POST(post("/api/v1/auth/code", { code }, { "x-forwarded-for": "10.0.0.1" }));
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.user).toEqual({ id: userId, email: "google@example.test", name: null });
    expect(typeof body.token).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await me({ authorization: `Bearer ${body.token}` })).status).toBe(200);

    const again = await POST(post("/api/v1/auth/code", { code }, { "x-forwarded-for": "10.0.0.1" }));
    expect(again.status).toBe(401);
  });

  it("rate-limits guessing from one address", async () => {
    const { POST } = await import("@/app/api/v1/auth/code/route");
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await POST(post("/api/v1/auth/code", { code: `guess-${i}` }, { "x-forwarded-for": "10.0.0.2" }))).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("rejects cross-site requests", async () => {
    const { POST } = await import("@/app/api/v1/auth/code/route");
    const res = await POST(post("/api/v1/auth/code", { code: "x" }, { origin: "https://evil.example", host: "localhost" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/auth/apple", () => {
  it("is 401 for a token that doesn't verify, and 400 without a nonce", async () => {
    const { POST } = await import("@/app/api/v1/auth/apple/route");
    expect((await POST(post("/api/v1/auth/apple", { identityToken: "a.b.c", nonce: "n" }, { "x-forwarded-for": "10.0.0.3" }))).status).toBe(401);
    expect((await POST(post("/api/v1/auth/apple", { identityToken: "a.b.c" }, { "x-forwarded-for": "10.0.0.3" }))).status).toBe(400);
  });
});

describe("POST /api/v1/auth/signout", () => {
  it("ends the app's session", async () => {
    const { POST } = await import("@/app/api/v1/auth/signout/route");
    const { token } = await createAppSession(db, await createTestUser(db));
    const res = await POST(new Request("http://localhost/api/v1/auth/signout", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(204);
    expect((await me({ authorization: `Bearer ${token}` })).status).toBe(401);
  });
});
