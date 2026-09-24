import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlanModelError } from "@/lib/ai/provider";
import { createFakePlanModel } from "@/lib/ai/providers/fake";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { aiGenerations } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { claimSeasonAiUse, usedSeasonAi } from "./seasonAi";
import { findAiLineups, findTradeWriteup, writeAiLineup, writeTradeWriteup } from "./seasonAiOutputs";
import { createTestLeague } from "./testLeagues";

const mine = [at("QB", player("QB", "QB", 20)), at("RB", player("RB1", "RB", 15)), at("RB", player("RB2", "RB", 12)), at("WR", player("WR1", "WR", 14)), at("WR", player("WR2", "WR", 11)), at("TE", player("TE", "TE", 8)), at("FLEX", player("Flex", "WR", 10)), player("Bench", "RB", 3)];
const theirs = [at("QB", player("Their QB", "QB", 18)), at("WR", player("Their WR", "WR", 13)), player("Their Bench", "RB", 7)];
const view = seasonView(mine, theirs);
const trade = { teamA: 1, gives: [mine[7].playerId], teamB: 2, gets: [theirs[2].playerId] };

const lineupJson = { intro: "Start the studs.", calls: [] };
const writeupJson = { lean: "accept", summary: "Small upgrade.", reasons: ["Bench for bench."], counter: { give: [], get: [], note: "" } };
const usage = { inputTokens: 1_000, outputTokens: 200 };

let db: Db;
let close: () => Promise<void>;
let userId: string;
let leagueId: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  userId = await createTestUser(db);
  leagueId = await createTestLeague(db, userId);
});

const generations = async () => (await db.select().from(aiGenerations)).filter((g) => g.leagueId === leagueId);

describe("writeAiLineup", () => {
  it("writes once per week and kind, stores it, and logs the cost", async () => {
    const model = createFakePlanModel(() => ({ json: lineupJson, usage }));
    const first = await writeAiLineup(db, model, { userId, leagueId, view, kind: "lineup-midweek" });
    expect(first).toMatchObject({ status: "ok", cached: false, output: { intro: "Start the studs." } });
    const again = await writeAiLineup(db, model, { userId, leagueId, view, kind: "lineup-midweek" });
    expect(again).toMatchObject({ status: "ok", cached: true, output: { intro: "Start the studs." } });
    expect(model.calls).toHaveLength(1);

    expect(await usedSeasonAi(db, leagueId, 2026, 5)).toEqual(["lineup-midweek"]);
    expect(Object.keys(await findAiLineups(db, leagueId, 2026, 5))).toEqual(["lineup-midweek"]);
    expect(await generations()).toEqual([expect.objectContaining({ purpose: "season-lineup", outcome: "ready", promptVersion: 1, inputTokens: 1_000, outputTokens: 200 })]);
  });

  it("answers used when the allowance went without a stored lineup", async () => {
    await claimSeasonAiUse(db, { leagueId, season: 2026, week: 5, kind: "lineup-sunday" });
    const model = createFakePlanModel(() => ({ json: lineupJson, usage }));
    expect(await writeAiLineup(db, model, { userId, leagueId, view, kind: "lineup-sunday" })).toEqual({ status: "used" });
    expect(model.calls).toHaveLength(0);
  });

  it("gives the allowance back when the model fails, and logs the failure", async () => {
    const model = createFakePlanModel(() => {
      throw new PlanModelError("unavailable", "down");
    });
    expect(await writeAiLineup(db, model, { userId, leagueId, view, kind: "lineup-midweek" })).toEqual({ status: "failed", kind: "unavailable" });
    expect(await usedSeasonAi(db, leagueId, 2026, 5)).toEqual([]);
    expect(await findAiLineups(db, leagueId, 2026, 5)).toEqual({});
    expect(await generations()).toEqual([expect.objectContaining({ purpose: "season-lineup", outcome: "unavailable", inputTokens: null })]);
  });

  it("rejects an output naming a player not in the input, and stores nothing", async () => {
    const model = createFakePlanModel(() => ({ json: { intro: "", calls: [{ slot: "s1", ref: "p99", reason: "" }] }, usage }));
    expect(await writeAiLineup(db, model, { userId, leagueId, view, kind: "lineup-midweek" })).toEqual({ status: "failed", kind: "invalid_output" });
    expect(await generations()).toEqual([expect.objectContaining({ outcome: "invalid_output", outputTokens: 200 })]);
  });
});

describe("writeTradeWriteup", () => {
  it("writes once per trade and week, whichever order the players came in", async () => {
    const model = createFakePlanModel(() => ({ json: writeupJson, usage }));
    expect(await writeTradeWriteup(db, model, { userId, leagueId, view, trade })).toMatchObject({ status: "ok", cached: false, output: { lean: "accept" } });
    expect(await writeTradeWriteup(db, model, { userId, leagueId, view, trade: { ...trade, gives: [...trade.gives].reverse() } })).toMatchObject({ status: "ok", cached: true });
    expect(model.calls).toHaveLength(1);
    expect(await findTradeWriteup(db, leagueId, view, trade)).toMatchObject({ output: { summary: "Small upgrade." } });
    expect(await findTradeWriteup(db, leagueId, { ...view, currentWeek: 6 }, trade)).toBeNull();
    expect(await generations()).toEqual([expect.objectContaining({ purpose: "season-trade", outcome: "ready" })]);
  });

  it("refuses a trade that isn't from the user's team, or names players off the rosters", async () => {
    const model = createFakePlanModel(() => ({ json: writeupJson, usage }));
    expect(await writeTradeWriteup(db, model, { userId, leagueId, view, trade: { ...trade, teamA: 2, teamB: 1 } })).toEqual({ status: "invalid-trade" });
    expect(await writeTradeWriteup(db, model, { userId, leagueId, view, trade: { ...trade, gets: [424242] } })).toEqual({ status: "invalid-trade" });
    expect(model.calls).toHaveLength(0);
  });

  it("stores nothing when the model fails", async () => {
    const model = createFakePlanModel(() => {
      throw new PlanModelError("timeout", "slow");
    });
    expect(await writeTradeWriteup(db, model, { userId, leagueId, view, trade })).toEqual({ status: "failed", kind: "timeout" });
    expect(await findTradeWriteup(db, leagueId, view, trade)).toBeNull();
  });
});
