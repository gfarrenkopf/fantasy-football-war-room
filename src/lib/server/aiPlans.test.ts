import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlanModelError, type ModelRequest } from "@/lib/ai/provider";
import { createFakePlanModel } from "@/lib/ai/providers/fake";
import { DATASET_ID, standardRoster } from "@/lib/data";
import { aiGenerations, aiPlans } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { LeagueRecord } from "@/lib/storage/types";
import { DEFAULT_PLAN_ALLOWANCE, FREE_REGENERATIONS, getPlanStatus, MAX_CONCURRENT_GENERATIONS, PLAN_LEASE_MS, requestPlan, runPlanJob, type PlanResult, type RequestPlanResult } from "./aiPlans";
import { upsertLeague } from "./leagues";

let db: Db;
let close: () => Promise<void>;
let alice: string;
let bob: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  await db.delete(aiPlans);
  await db.delete(aiGenerations);
  alice = await createTestUser(db);
  bob = await createTestUser(db);
});

let seq = 0;
async function createLeague(userId: string, patch: Partial<LeagueRecord["settings"]> = {}): Promise<LeagueRecord> {
  const league: LeagueRecord = {
    id: `plan-league-${++seq}`,
    name: "Home league",
    season: 2026,
    datasetId: DATASET_ID,
    settings: {
      teams: 12,
      mySlot: 1,
      scoring: "ppr",
      valueThreshold: 10,
      roster: standardRoster(),
      ...patch,
    },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  await upsertLeague(db, userId, league);
  return league;
}

async function updateSettings(userId: string, league: LeagueRecord, patch: Partial<LeagueRecord["settings"]>) {
  const updatedAt = new Date(Date.parse(league.updatedAt) + 1000).toISOString();
  await upsertLeague(db, userId, {
    ...league,
    settings: { ...league.settings, ...patch },
    updatedAt,
  });
}

/**
 * A fake model that answers from the prompt's own candidates: for every turn, the first candidates
 * as targets and take. Enough to produce a valid plan without parsing the prompt.
 */
function planModel() {
  return createFakePlanModel((request: ModelRequest) => {
    const turns = [...request.user.matchAll(/^## picks? ([\d &]+) \(/gm)].map((m) => m[1].split(" & ").map(Number));
    const sections = request.user.split(/^## /m).slice(1);
    return {
      json: {
        intro: "Plan.",
        turns: turns.map((picks, i) => {
          const refs = [...sections[i].matchAll(/^\[(p\d+)\]/gm)].map((m) => m[1]);
          return {
            pick: picks[0],
            open: "",
            note: "Why.",
            take: refs.slice(0, picks.length),
            targets: refs.slice(0, 3),
            fallbacks: [],
            letGo: [],
          };
        }),
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  });
}

const result = (r: RequestPlanResult | PlanResult | null): PlanResult => {
  if (!r || "invalidLeague" in r) throw new Error(`expected a plan result, got ${JSON.stringify(r)}`);
  return r;
};

const minutes = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);

describe("AI plan jobs", () => {
  it("queues and claims a job, then serves the finished plan without calling the model again", async () => {
    const league = await createLeague(alice);
    const now = new Date();
    const requested = result(await requestPlan(db, alice, league.id, now));
    expect(requested.view).toMatchObject({
      status: "generating",
      plan: null,
      stale: false,
    });
    expect(requested.claimedJobId).toEqual(expect.any(String));

    const model = planModel();
    await runPlanJob(db, league.id, requested.claimedJobId!, { model });
    expect(model.calls).toHaveLength(1);

    const reloaded = result(await getPlanStatus(db, alice, league.id));
    expect(reloaded.claimedJobId).toBeNull();
    expect(reloaded.view).toMatchObject({
      status: "ready",
      stale: false,
      error: null,
    });
    expect(reloaded.view.plan!.turns.map((t) => t.picks[0])).toEqual([1, 24, 48, 72, 96, 120, 144, 168, 192]);
    expect(reloaded.view.generatedAt).toEqual(expect.any(String));

    // Asking again for the same settings returns the plan without a new job.
    const again = result(await requestPlan(db, alice, league.id));
    expect(again).toMatchObject({
      claimedJobId: null,
      view: { status: "ready" },
    });
    expect(model.calls).toHaveLength(1);
  });

  it("returns the running job to a second request instead of starting another", async () => {
    const league = await createLeague(alice);
    const first = result(await requestPlan(db, alice, league.id));
    const second = result(await requestPlan(db, alice, league.id));
    expect(second).toMatchObject({
      claimedJobId: null,
      view: { status: "generating" },
    });
    const [row] = await db.select().from(aiPlans).where(eq(aiPlans.leagueId, league.id));
    expect(row).toMatchObject({ jobId: first.claimedJobId, attempts: 1 });
  });

  it("reclaims a job whose lease expired, and fences out the dead job's late result", async () => {
    const league = await createLeague(alice);
    const start = new Date();
    const dead = result(await requestPlan(db, alice, league.id, start));

    // Before the lease runs out, polls leave the job alone.
    expect(result(await getPlanStatus(db, alice, league.id, minutes(start, 1))).claimedJobId).toBeNull();

    const later = new Date(start.getTime() + PLAN_LEASE_MS + 1000);
    const revived = result(await getPlanStatus(db, alice, league.id, later));
    expect(revived.claimedJobId).toEqual(expect.any(String));
    expect(revived.claimedJobId).not.toBe(dead.claimedJobId);

    // The original job finishes after all: its result is dropped.
    await runPlanJob(db, league.id, dead.claimedJobId!, { model: planModel() });
    expect(result(await getPlanStatus(db, alice, league.id, later)).view).toMatchObject({ status: "generating", plan: null });

    await runPlanJob(db, league.id, revived.claimedJobId!, {
      model: planModel(),
    });
    expect(result(await getPlanStatus(db, alice, league.id, later)).view.status).toBe("ready");
  });

  it("queues past the concurrency cap and claims on a later poll once there's room", async () => {
    const now = new Date();
    const running: { league: LeagueRecord; jobId: string }[] = [];
    for (let i = 0; i < MAX_CONCURRENT_GENERATIONS; i++) {
      const league = await createLeague(alice);
      running.push({
        league,
        jobId: result(await requestPlan(db, alice, league.id, now)).claimedJobId!,
      });
    }
    const waiting = await createLeague(bob);
    const queued = result(await requestPlan(db, bob, waiting.id, minutes(now, 0.1)));
    expect(queued).toMatchObject({
      claimedJobId: null,
      view: { status: "queued", queuePosition: 1 },
    });
    expect(result(await getPlanStatus(db, bob, waiting.id, minutes(now, 0.2))).claimedJobId).toBeNull();

    await runPlanJob(db, running[0].league.id, running[0].jobId, {
      model: planModel(),
    });
    const claimed = result(await getPlanStatus(db, bob, waiting.id, minutes(now, 0.3)));
    expect(claimed.claimedJobId).toEqual(expect.any(String));
    expect(claimed.view.status).toBe("generating");
  });

  it("records a failure, keeps the previous plan, and lets the user try again", async () => {
    const league = await createLeague(alice);
    await runPlanJob(db, league.id, result(await requestPlan(db, alice, league.id)).claimedJobId!, { model: planModel() });

    await updateSettings(alice, league, { mySlot: 6 });
    const stale = result(await getPlanStatus(db, alice, league.id));
    expect(stale.view).toMatchObject({ status: "ready", stale: true });

    const retry = result(await requestPlan(db, alice, league.id));
    const failing = createFakePlanModel(() => {
      throw new PlanModelError("timeout", "slow");
    });
    await runPlanJob(db, league.id, retry.claimedJobId!, { model: failing });
    const failed = result(await getPlanStatus(db, alice, league.id));
    expect(failed.view).toMatchObject({
      status: "failed",
      stale: true,
      error: { kind: "timeout", retryable: true },
    });
    expect(failed.view.plan).not.toBeNull();

    const again = result(await requestPlan(db, alice, league.id));
    expect(again.claimedJobId).toEqual(expect.any(String));
    await runPlanJob(db, league.id, again.claimedJobId!, {
      model: planModel(),
    });
    const fresh = result(await getPlanStatus(db, alice, league.id));
    expect(fresh.view).toMatchObject({
      status: "ready",
      stale: false,
      error: null,
    });
    expect(fresh.view.plan!.turns[0].picks).toEqual([6]);
  });

  it("gives up on a model that never answers, so the user falls back instead of waiting on a held lease", async () => {
    const league = await createLeague(alice);
    const job = result(await requestPlan(db, alice, league.id));
    const hung = createFakePlanModel(() => new Promise(() => {}));
    await runPlanJob(db, league.id, job.claimedJobId!, { model: hung, timeoutMs: 20 });
    expect(result(await getPlanStatus(db, alice, league.id)).view).toMatchObject({
      status: "failed",
      plan: null,
      error: { kind: "timeout", retryable: true },
    });
  });

  it("discards a job's result when the settings changed and a new job was requested mid-run", async () => {
    const league = await createLeague(alice);
    const old = result(await requestPlan(db, alice, league.id));
    await updateSettings(alice, league, { mySlot: 12 });
    const replaced = result(await requestPlan(db, alice, league.id));
    expect(replaced.claimedJobId).not.toBe(old.claimedJobId);

    await runPlanJob(db, league.id, old.claimedJobId!, { model: planModel() });
    expect(result(await getPlanStatus(db, alice, league.id)).view.plan).toBeNull();
  });

  it("logs unexpected errors and marks the job failed", async () => {
    const league = await createLeague(alice);
    const job = result(await requestPlan(db, alice, league.id));
    const errors: string[] = [];
    const original = console.error;
    console.error = (line: string) => void errors.push(line);
    try {
      await runPlanJob(db, league.id, job.claimedJobId!, {
        model: createFakePlanModel(() => Promise.reject(new TypeError("boom"))),
      });
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([expect.stringMatching(/^\[server-error\] .*"TypeError: boom"/)]);
    expect(result(await getPlanStatus(db, alice, league.id)).view.error).toEqual({ kind: "internal", retryable: true });
  });

  it("logs every model call with its usage and cost: saved, failed, and superseded", async () => {
    const generations = async (leagueId: string) =>
      (await db.select().from(aiGenerations).where(eq(aiGenerations.leagueId, leagueId)).orderBy(aiGenerations.createdAt)).map((row) => ({
        outcome: row.outcome,
        jobId: row.jobId,
        userId: row.userId,
        tokens: [row.inputTokens, row.outputTokens],
        costUsd: row.costUsd,
      }));
    const sonnet = (respond: Parameters<typeof createFakePlanModel>[0]) => Object.assign(createFakePlanModel(respond), { provider: "anthropic", model: "claude-sonnet-5" });

    const league = await createLeague(alice);
    const first = result(await requestPlan(db, alice, league.id)).claimedJobId!;
    await runPlanJob(db, league.id, first, { model: planModel() });
    expect(await generations(league.id)).toEqual([{ outcome: "ready", jobId: first, userId: alice, tokens: [10, 5], costUsd: null }]); // the fake model has no price

    await updateSettings(alice, league, { mySlot: 3 });
    const failing = result(await requestPlan(db, alice, league.id)).claimedJobId!;
    await runPlanJob(db, league.id, failing, {
      model: sonnet(() => {
        throw new PlanModelError("truncated", "too long", { inputTokens: 10_000, outputTokens: 32_000 });
      }),
    });

    const stale = result(await requestPlan(db, alice, league.id)).claimedJobId!;
    const good = planModel();
    const outrun = sonnet(async (request) => {
      // The user changes settings and asks again while this job's model call is running.
      await updateSettings(alice, { ...league, updatedAt: "2026-09-01T00:00:05.000Z" }, { mySlot: 4 });
      await requestPlan(db, alice, league.id);
      return good.generate(request);
    });
    await runPlanJob(db, league.id, stale, { model: outrun });

    const logged = await generations(league.id);
    expect(logged.slice(1)).toEqual([
      { outcome: "truncated", jobId: failing, userId: alice, tokens: [10_000, 32_000], costUsd: 0.34 },
      { outcome: "superseded", jobId: stale, userId: alice, tokens: [10, 5], costUsd: expect.closeTo(0.00007, 6) },
    ]);
  });

  it("rejects leagues that don't fit the player data", async () => {
    const league = await createLeague(alice, {
      teams: 20,
      roster: standardRoster(20),
    });
    expect(await requestPlan(db, alice, league.id)).toEqual({
      invalidLeague: [expect.any(String)],
    });
  });

  it("never shows or starts another user's plan", async () => {
    const league = await createLeague(alice);
    await requestPlan(db, alice, league.id);
    expect(await getPlanStatus(db, bob, league.id)).toBeNull();
    expect(await requestPlan(db, bob, league.id)).toBeNull();
    expect(await getPlanStatus(db, alice, "missing")).toBeNull();
  });
});

describe("regeneration limits", () => {
  /** Requests a plan and, if that started a job, writes it with `model`. */
  async function write(league: LeagueRecord, model = planModel(), options: { regenerate?: boolean; allowance?: number } = {}) {
    const requested = result(await requestPlan(db, alice, league.id, new Date(), options));
    if (requested.claimedJobId) await runPlanJob(db, league.id, requested.claimedJobId, { model });
    return requested;
  }
  const status = async (league: LeagueRecord) => result(await getPlanStatus(db, alice, league.id)).view;

  it("writes a new version of an up-to-date plan only when asked, counting down the rewrites", async () => {
    const league = await createLeague(alice);
    expect((await status(league)).regenerationsLeft).toBeNull();
    const model = planModel();
    await write(league, model);
    expect(await status(league)).toMatchObject({ status: "ready", regenerationsLeft: FREE_REGENERATIONS });

    await write(league, model); // same settings, no regenerate: the saved plan
    expect(model.calls).toHaveLength(1);

    const again = await write(league, model, { regenerate: true });
    expect(again.claimedJobId).toEqual(expect.any(String));
    expect(model.calls).toHaveLength(2);
    expect(await status(league)).toMatchObject({ status: "ready", regenerationsLeft: FREE_REGENERATIONS - 1, limitReached: false });
  });

  it("re-serves the saved plan past the allowance, for regenerations and settings rewrites alike", async () => {
    const league = await createLeague(alice);
    const model = planModel();
    await write(league, model);
    for (let i = 0; i < FREE_REGENERATIONS; i++) await write(league, model, { regenerate: true });
    expect(model.calls).toHaveLength(DEFAULT_PLAN_ALLOWANCE);

    const refused = await write(league, model, { regenerate: true });
    expect(refused).toMatchObject({ claimedJobId: null, view: { status: "ready", stale: false, regenerationsLeft: 0, limitReached: true } });

    await updateSettings(alice, league, { mySlot: 9 });
    const stale = await write(league, model);
    expect(stale).toMatchObject({ claimedJobId: null, view: { status: "ready", stale: true, limitReached: true } });
    expect(stale.view.plan).not.toBeNull();

    expect(model.calls).toHaveLength(DEFAULT_PLAN_ALLOWANCE);
    const [row] = await db.select().from(aiPlans).where(eq(aiPlans.leagueId, league.id));
    expect(row.status).toBe("ready");
    expect(await db.select().from(aiGenerations).where(eq(aiGenerations.leagueId, league.id))).toHaveLength(DEFAULT_PLAN_ALLOWANCE);

    // A bigger allowance (what a paid entitlement would grant) lifts the limit.
    const lifted = await write(league, model, { allowance: 10 });
    expect(lifted.claimedJobId).toEqual(expect.any(String));
    expect(await status(league)).toMatchObject({ status: "ready", stale: false });
  });

  it("doesn't count failed or outrun attempts", async () => {
    const league = await createLeague(alice);
    await write(league);
    const failing = createFakePlanModel(() => {
      throw new PlanModelError("unavailable", "down");
    });
    for (let i = 0; i < DEFAULT_PLAN_ALLOWANCE; i++) await write(league, failing, { regenerate: true });
    expect(await status(league)).toMatchObject({ status: "failed", regenerationsLeft: FREE_REGENERATIONS });

    const outrun = result(await requestPlan(db, alice, league.id, new Date(), { regenerate: true }));
    await updateSettings(alice, league, { mySlot: 2 });
    const replacement = result(await requestPlan(db, alice, league.id));
    await runPlanJob(db, league.id, outrun.claimedJobId!, { model: planModel() });
    await runPlanJob(db, league.id, replacement.claimedJobId!, { model: planModel() });
    expect(await status(league)).toMatchObject({ status: "ready", stale: false, regenerationsLeft: FREE_REGENERATIONS - 1 });
  });
});
