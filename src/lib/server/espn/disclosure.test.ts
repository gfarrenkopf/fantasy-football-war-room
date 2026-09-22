import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { acknowledgeDisclosure, hasAcknowledgedDisclosure } from "./disclosure";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

describe("ESPN sync disclosure", () => {
  it("records an acknowledgement, and asks again when the version moves on", async () => {
    const user = await createTestUser(db);
    expect(await hasAcknowledgedDisclosure(db, user, 1)).toBe(false);
    await acknowledgeDisclosure(db, user, 1);
    expect(await hasAcknowledgedDisclosure(db, user, 1)).toBe(true);
    expect(await hasAcknowledgedDisclosure(db, user, 2)).toBe(false);
    await acknowledgeDisclosure(db, user, 2);
    expect(await hasAcknowledgedDisclosure(db, user, 2)).toBe(true);
  });
});
