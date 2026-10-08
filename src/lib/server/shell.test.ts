import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";

vi.mock("server-only", () => ({}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const KEY = randomBytes(32);
const LOGIN = { espnS2: "AEB-not-a-real-espn-s2-cookie-%2F%3D", swid: "{154E132F-8C13-4AC0-9DAC-20C2C5625594}" };

async function load(env: Record<string, string> = {}) {
  const vars = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: KEY.toString("base64"), ESPN_SYNC_ALLOWLIST: "", ...env };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  const [{ loadShell }, logins] = await Promise.all([import("./shell"), import("./espn/logins")]);
  return { loadShell, logins };
}

describe("the account menu's ESPN connection (APE-335)", () => {
  it("offers to connect when there's no login yet, and shows its state when there is", async () => {
    const { loadShell, logins } = await load();
    const userId = await createTestUser(db);
    expect((await loadShell(db, { userId })).espn).toEqual({ seasonEmails: null, login: null });

    await logins.storeLogin(db, KEY, userId, LOGIN, { season: 2026, consentVersion: 3 });
    expect((await loadShell(db, { userId })).espn).toMatchObject({ login: "connected" });
    await logins.markDisconnected(db, userId);
    expect((await loadShell(db, { userId })).espn).toMatchObject({ login: "disconnected" });
  });

  it("offers nothing where in-season help isn't on for the user", async () => {
    const { loadShell } = await load({ ESPN_SYNC_ALLOWLIST: "someone-else@example.test" });
    const userId = await createTestUser(db);
    expect((await loadShell(db, { userId, email: "fan@example.test" })).espn).toBeNull();
  });
});
