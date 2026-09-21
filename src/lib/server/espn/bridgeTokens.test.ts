import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { espnBridgeTokens } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { deleteLeague } from "../leagues";
import { createTestLeague } from "../testLeagues";
import { BRIDGE_TOKEN_TTL_MS, EXPIRED_TOKEN_RETENTION_MS, lastPairedLeague, mintBridgeToken, purgeExpiredBridgeTokens, revokeBridgeTokens, verifyBridgeToken } from "./bridgeTokens";

let db: Db;
let close: () => Promise<void>;
let alice: string;
let league: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  alice = await createTestUser(db, `${crypto.randomUUID()}@example.test`);
  league = await createTestLeague(db, alice);
});

const scope = () => ({ userId: alice, leagueId: league, espnLeagueId: "704343562", espnTeamId: 1, season: 2026 });
const t0 = new Date("2026-09-21T22:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

describe("bridge tokens", () => {
  it("verifies a minted token to its scope and the owner's email", async () => {
    const { token, expiresAt } = await mintBridgeToken(db, scope(), t0);
    expect(expiresAt).toEqual(later(BRIDGE_TOKEN_TTL_MS));
    const verified = await verifyBridgeToken(db, token, later(1000));
    expect(verified).toMatchObject({ ...scope(), expiresAt });
    expect(verified?.email).toMatch(/@example\.test$/);
  });

  it("stores only a hash of the token", async () => {
    const { token } = await mintBridgeToken(db, scope(), t0);
    const rows = await db.select().from(espnBridgeTokens);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
  });

  it("rejects unknown, empty and expired tokens", async () => {
    const { token } = await mintBridgeToken(db, scope(), t0);
    expect(await verifyBridgeToken(db, "not-a-token", t0)).toBeNull();
    expect(await verifyBridgeToken(db, "", t0)).toBeNull();
    expect(await verifyBridgeToken(db, token, later(BRIDGE_TOKEN_TTL_MS + 1))).toBeNull();
  });

  it("stops working when its league is deleted", async () => {
    const { token } = await mintBridgeToken(db, scope(), t0);
    await deleteLeague(db, alice, league);
    expect(await verifyBridgeToken(db, token, later(1000))).toBeNull();
  });

  it("revokes every token for a league, and only the owner's", async () => {
    const { token } = await mintBridgeToken(db, scope(), t0);
    const bob = await createTestUser(db);
    expect(await revokeBridgeTokens(db, bob, league)).toBe(0);
    expect(await revokeBridgeTokens(db, alice, league)).toBe(1);
    expect(await verifyBridgeToken(db, token, later(1000))).toBeNull();
  });

  it("purges tokens past their retention, and keeps recently expired ones for pairing memory", async () => {
    const old = await mintBridgeToken(db, scope(), t0);
    const expired = BRIDGE_TOKEN_TTL_MS + 1;
    await purgeExpiredBridgeTokens(db, later(expired));
    expect(await verifyBridgeToken(db, old.token, t0)).not.toBeNull(); // row kept
    const fresh = await mintBridgeToken(db, scope(), later(expired + EXPIRED_TOKEN_RETENTION_MS));
    await purgeExpiredBridgeTokens(db, later(expired + EXPIRED_TOKEN_RETENTION_MS));
    // Gone, not merely expired: it no longer verifies even at a time it would have been valid.
    expect(await verifyBridgeToken(db, old.token, t0)).toBeNull();
    expect(await verifyBridgeToken(db, fresh.token, later(expired + EXPIRED_TOKEN_RETENTION_MS + 1))).not.toBeNull();
  });

  it("remembers which league an ESPN league was last paired with, even after the token expires", async () => {
    expect(await lastPairedLeague(db, alice, "704343562")).toBeNull();
    const second = await createTestLeague(db, alice, "Work league");
    await mintBridgeToken(db, scope(), t0);
    await mintBridgeToken(db, { ...scope(), leagueId: second }, later(1000));
    expect(await lastPairedLeague(db, alice, "704343562")).toBe(second);
    expect(await lastPairedLeague(db, alice, "111")).toBeNull();
    await deleteLeague(db, alice, second);
    expect(await lastPairedLeague(db, alice, "704343562")).toBe(league);
  });
});
