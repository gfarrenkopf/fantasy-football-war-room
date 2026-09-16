import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { entitlements } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { grantEntitlement, hasEntitlement, SEASON_PASS } from "./entitlements";
import { deleteLeague } from "./leagues";
import { createTestLeague } from "./testLeagues";

let db: Db;
let close: () => Promise<void>;
let alice: string;
let bob: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  alice = await createTestUser(db);
  bob = await createTestUser(db);
});

const grant = (leagueId: string, userId: string, source = "cs_test_1") => ({ leagueId, userId, kind: SEASON_PASS, source, amountTotal: 999, currency: "usd" });

describe("entitlements", () => {
  it("grants once; a retried grant changes nothing", async () => {
    const id = await createTestLeague(db, alice);
    expect(await hasEntitlement(db, id, SEASON_PASS)).toBe(false);
    expect(await grantEntitlement(db, grant(id, alice))).toBe("granted");
    expect(await grantEntitlement(db, grant(id, alice, "cs_test_2"))).toBe("exists");
    expect(await hasEntitlement(db, id, SEASON_PASS)).toBe(true);
    expect(await db.select().from(entitlements)).toContainEqual(expect.objectContaining({ leagueId: id, source: "cs_test_1", amountTotal: 999, currency: "usd" }));
  });

  it("won't grant for an unknown league, or one owned by a different user", async () => {
    const id = await createTestLeague(db, alice);
    expect(await grantEntitlement(db, grant("no-such-league", alice))).toBe("no-league");
    expect(await grantEntitlement(db, grant(id, bob))).toBe("no-league");
    expect(await hasEntitlement(db, id, SEASON_PASS)).toBe(false);
  });

  it("still grants for a league deleted after paying", async () => {
    const id = await createTestLeague(db, alice);
    await deleteLeague(db, alice, id);
    expect(await grantEntitlement(db, grant(id, alice))).toBe("granted");
  });
});
