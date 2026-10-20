import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { users } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { decideSeasonAccess, isSeasonBetaTester, seasonAccessStamp, stampSeasonAccess } from "./seasonAccess";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

describe("decideSeasonAccess", () => {
  const decide = (over: Partial<Parameters<typeof decideSeasonAccess>[0]> = {}) =>
    decideSeasonAccess({ mode: "closed", allowlist: ["greg@apeman.tech"], email: "fan@example.test", stamped: async () => false, ...over });

  it("lets every account in while open, without looking up a stamp", async () => {
    const stamped = vi.fn(async () => false);
    expect(await decide({ mode: "open", stamped })).toBe(true);
    expect(await decide({ mode: "open", email: null, allowlist: [], stamped })).toBe(true);
    expect(stamped).not.toHaveBeenCalled();
  });

  it("while closed, lets in the listed accounts, whatever their case, without looking up a stamp", async () => {
    const stamped = vi.fn(async () => false);
    expect(await decide({ email: "Greg@Apeman.tech", stamped })).toBe(true);
    expect(stamped).not.toHaveBeenCalled();
  });

  it("while closed, lets in stamped accounts and keeps everyone else out", async () => {
    expect(await decide({ stamped: async () => true })).toBe(true);
    expect(await decide({ email: null, stamped: async () => true })).toBe(true);
    expect(await decide()).toBe(false);
    expect(await decide({ email: null })).toBe(false);
    // An empty list no longer means open.
    expect(await decide({ allowlist: [] })).toBe(false);
  });
});

describe("season access stamps", () => {
  it("stamps once, as a beta tester, and leaves an existing stamp alone", async () => {
    const userId = await createTestUser(db);
    expect(await seasonAccessStamp(db, userId)).toBeNull();
    expect(await isSeasonBetaTester(db, userId)).toBe(false);
    const at = new Date("2026-10-01T12:00:00Z");
    await stampSeasonAccess(db, userId, at);
    await stampSeasonAccess(db, userId, new Date("2026-10-08T12:00:00Z"));
    expect(await seasonAccessStamp(db, userId)).toEqual({ at, via: "open" });
    expect(await isSeasonBetaTester(db, userId)).toBe(true);
  });

  it("counts a hand invite as access, but not as a beta tester", async () => {
    const userId = await createTestUser(db);
    const at = new Date("2026-11-01T12:00:00Z");
    await db.update(users).set({ seasonAccessAt: at, seasonAccessVia: "invite" }).where(eq(users.id, userId));
    await stampSeasonAccess(db, userId);
    expect(await seasonAccessStamp(db, userId)).toEqual({ at, via: "invite" });
    expect(await isSeasonBetaTester(db, userId)).toBe(false);
  });
});
