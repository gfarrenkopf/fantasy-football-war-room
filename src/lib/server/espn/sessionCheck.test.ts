import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { loginStatus, storeLogin } from "./logins";

vi.mock("server-only", () => ({}));
const { createSessionCheck } = await import("./sessionCheck");

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const KEY = randomBytes(32);
const LOGIN = { espnS2: "AEB%2Fnot-real", swid: "{154E132F-8C13-4AC0-9DAC-20C2C5625594}" };
const LEAGUE = { season: 2026, espnLeagueId: "110222051" };

async function connected() {
  const userId = await createTestUser(db);
  await storeLogin(db, KEY, userId, LOGIN, { season: 2026, consentVersion: 1 });
  return userId;
}

const check = (respond: () => Response) => {
  const fetchImpl = vi.fn<typeof fetch>(async () => respond());
  return { signedOut: createSessionCheck({ fetchImpl, now: () => new Date("2026-10-05T23:00:00Z") }), fetchImpl };
};

describe("confirming ESPN signed the user out", () => {
  it("disconnects the login when ESPN refuses it a second time", async () => {
    const userId = await connected();
    const { signedOut, fetchImpl } = check(() => new Response("{}", { status: 401 }));
    expect(await signedOut(db, userId, LOGIN, LEAGUE)).toBe(true);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/seasons/2026/segments/0/leagues/110222051?view=mSettings");
    expect((await loginStatus(db, userId))?.status).toBe("disconnected");
  });

  it("keeps the login, and notes ESPN took it, when the second read works", async () => {
    const userId = await connected();
    const { signedOut } = check(() => new Response("{}"));
    expect(await signedOut(db, userId, LOGIN, LEAGUE)).toBe(false);
    expect(await loginStatus(db, userId)).toMatchObject({ status: "connected", verifiedAt: new Date("2026-10-05T23:00:00Z") });
  });

  it("keeps the login when ESPN doesn't answer", async () => {
    const userId = await connected();
    const { signedOut } = check(() => new Response("", { status: 503 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await signedOut(db, userId, LOGIN, LEAGUE)).toBe(false);
    expect(await loginStatus(db, userId)).toMatchObject({ status: "connected", verifiedAt: null });
  });
});
