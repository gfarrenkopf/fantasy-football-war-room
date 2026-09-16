import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aiGenerations, type GenerationOutcome } from "@/lib/db/schema";
import { createTestDb } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { costReport } from "./aiCosts";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  await db.delete(aiGenerations);
});

function generation(leagueId: string, createdAt: string, outcome: GenerationOutcome, costUsd: number | null, model = "claude-sonnet-5") {
  return {
    leagueId,
    userId: "u1",
    jobId: crypto.randomUUID(),
    provider: "anthropic",
    model,
    promptVersion: 1,
    outcome,
    inputTokens: costUsd === null ? null : 8_000,
    cachedInputTokens: costUsd === null ? null : 0,
    outputTokens: costUsd === null ? null : 9_000,
    costUsd,
    durationMs: 70_000,
    createdAt: new Date(createdAt),
  };
}

describe("AI plan cost report", () => {
  it("averages cost per league over a date range, counting every call a league made", async () => {
    await db.insert(aiGenerations).values([
      generation("a", "2026-09-10T12:00:00Z", "ready", 0.1),
      generation("a", "2026-09-11T12:00:00Z", "ready", 0.12), // a regeneration
      generation("b", "2026-09-12T12:00:00Z", "invalid_output", 0.08),
      generation("b", "2026-09-12T12:05:00Z", "ready", 0.1),
      generation("c", "2026-09-13T12:00:00Z", "timeout", null), // cut off: no usage reported
      generation("a", "2026-09-01T12:00:00Z", "ready", 5), // before the range
      generation("d", "2026-09-20T00:00:00Z", "ready", 5), // `to` is exclusive
    ]);

    const report = await costReport(db, { from: new Date("2026-09-10T00:00:00Z"), to: new Date("2026-09-20T00:00:00Z") });
    expect(report).toMatchObject({ generations: 5, leagues: 3, unpriced: 1, outcomes: { ready: 3, invalid_output: 1, timeout: 1 } });
    expect(report.totalUsd).toBeCloseTo(0.4, 6);
    expect(report.avgUsdPerLeague).toBeCloseTo(0.4 / 3, 6);
    expect(report.avgUsdPerGeneration).toBeCloseTo(0.08, 6);
    expect(report.models).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5", generations: 5, totalUsd: expect.closeTo(0.4, 6), avgInputTokens: 8_000, avgOutputTokens: 9_000, maxOutputTokens: 9_000 },
    ]);
  });

  it("reports an empty range without dividing by zero", async () => {
    const report = await costReport(db, { from: new Date("2026-01-01"), to: new Date("2026-02-01") });
    expect(report).toMatchObject({ generations: 0, leagues: 0, totalUsd: 0, avgUsdPerLeague: null, avgUsdPerGeneration: null, outcomes: {}, models: [] });
  });
});
