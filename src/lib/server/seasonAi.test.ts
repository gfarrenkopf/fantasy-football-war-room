import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { grantEntitlement, SEASON_PASS } from "./entitlements";
import { claimSeasonAiUse, decideSeasonAiAccess, releaseSeasonAiUse, seasonAiAccess, startTrial, TRIAL_WEEKS, usedSeasonAi } from "./seasonAi";
import { createTestLeague } from "./testLeagues";

describe("decideSeasonAiAccess", () => {
  const decide = (over: Partial<Parameters<typeof decideSeasonAiAccess>[0]> = {}) =>
    decideSeasonAiAccess({ paymentsEnabled: true, allowlist: [], email: "fan@example.test", week: 4, trialStartWeek: null, isEntitled: async () => false, ...over });

  it("with payments off, lets AI_ALLOWLIST decide and never counts a trial", async () => {
    expect(await decide({ paymentsEnabled: false })).toEqual({ kind: "allowed", via: "open" });
    expect(await decide({ paymentsEnabled: false, allowlist: ["other@example.test"] })).toEqual({ kind: "not-allowed" });
    expect(await decide({ paymentsEnabled: false, allowlist: ["fan@example.test"], trialStartWeek: 1, week: 12 })).toEqual({ kind: "allowed", via: "allowlist" });
  });

  it("lets allowlisted accounts skip the paywall", async () => {
    expect(await decide({ allowlist: ["fan@example.test"], trialStartWeek: 1, week: 12 })).toEqual({ kind: "allowed", via: "allowlist" });
  });

  it("starts the trial in the week of first use, not NFL week 1", async () => {
    expect(await decide({ week: 9 })).toEqual({ kind: "allowed", via: "trial", trialWeek: 1, started: false });
    expect(await decide({ week: 9, trialStartWeek: 9 })).toEqual({ kind: "allowed", via: "trial", trialWeek: 1, started: true });
  });

  it("allows the 5th trial week and paywalls the 6th", async () => {
    expect(await decide({ trialStartWeek: 3, week: 3 + TRIAL_WEEKS - 1 })).toEqual({ kind: "allowed", via: "trial", trialWeek: 5, started: true });
    expect(await decide({ trialStartWeek: 3, week: 3 + TRIAL_WEEKS })).toEqual({ kind: "needs-purchase" });
  });

  it("allows a league with a pass after the trial, without trial wording during it", async () => {
    expect(await decide({ trialStartWeek: 1, week: 10, isEntitled: async () => true })).toEqual({ kind: "allowed", via: "pass" });
    expect(await decide({ isEntitled: async () => true })).toEqual({ kind: "allowed", via: "pass" });
  });
});

describe("season AI in the database", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: string;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(() => close());
  beforeEach(async () => {
    userId = await createTestUser(db);
  });

  const access = (leagueId: string, week: number, over: { leagueSeason?: number } = {}) =>
    seasonAiAccess(db, { paymentsEnabled: true, allowlist: [], userId, email: null, leagueId, leagueSeason: over.leagueSeason ?? 2026, season: 2026, week });

  it("records the first-use week once, per account, whichever league used it", async () => {
    const home = await createTestLeague(db, userId);
    const work = await createTestLeague(db, userId, "Work league");
    expect(await access(home, 4)).toEqual({ kind: "allowed", via: "trial", trialWeek: 1, started: false });
    expect(await startTrial(db, userId, 2026, 4)).toBe(4);
    // Linking another league later doesn't restart it.
    expect(await startTrial(db, userId, 2026, 7)).toBe(4);
    expect(await access(work, 7)).toEqual({ kind: "allowed", via: "trial", trialWeek: 4, started: true });
  });

  it("after the trial, unlocks only the paid league", async () => {
    const paid = await createTestLeague(db, userId);
    const unpaid = await createTestLeague(db, userId, "Work league");
    await grantEntitlement(db, { leagueId: paid, userId, kind: SEASON_PASS, source: "cs_test", amountTotal: 999, currency: "usd" });
    await startTrial(db, userId, 2026, 2);
    expect(await access(paid, 8)).toEqual({ kind: "allowed", via: "pass" });
    expect(await access(unpaid, 8)).toEqual({ kind: "needs-purchase" });
  });

  it("doesn't count a pass bought for another season", async () => {
    const lastYear = await createTestLeague(db, userId);
    await grantEntitlement(db, { leagueId: lastYear, userId, kind: SEASON_PASS, source: "cs_test", amountTotal: 999, currency: "usd" });
    await startTrial(db, userId, 2026, 1);
    expect(await access(lastYear, 9, { leagueSeason: 2025 })).toEqual({ kind: "needs-purchase" });
  });

  it("gives each league one mid-week and one Sunday lineup per week, reset at the next week", async () => {
    const leagueId = await createTestLeague(db, userId);
    const use = { leagueId, season: 2026, week: 5 };
    expect(await claimSeasonAiUse(db, { ...use, kind: "lineup-midweek" })).toBe(true);
    expect(await claimSeasonAiUse(db, { ...use, kind: "lineup-midweek" })).toBe(false);
    expect(await claimSeasonAiUse(db, { ...use, kind: "lineup-sunday" })).toBe(true);
    expect(await usedSeasonAi(db, leagueId, 2026, 5)).toEqual(["lineup-midweek", "lineup-sunday"]);

    expect(await usedSeasonAi(db, leagueId, 2026, 6)).toEqual([]);
    expect(await claimSeasonAiUse(db, { ...use, week: 6, kind: "lineup-midweek" })).toBe(true);
  });

  it("gives an allowance back when it's released", async () => {
    const leagueId = await createTestLeague(db, userId);
    const use = { leagueId, season: 2026, week: 5, kind: "lineup-midweek" as const };
    await claimSeasonAiUse(db, use);
    await releaseSeasonAiUse(db, use);
    expect(await usedSeasonAi(db, leagueId, 2026, 5)).toEqual([]);
    expect(await claimSeasonAiUse(db, use)).toBe(true);
  });
});
