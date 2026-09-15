import { describe, expect, it } from "vitest";
import { dataset, DEFAULT_LEAGUE } from "@/lib/data";
import type { DraftPick } from "../types";
import { survival, survivalOdds } from "./availability";
import { createSimContext } from "./context";
import { mulberry32 } from "./rng";
import { simulateFrom } from "./simulate";
import { defaultRoom } from "./styles";
import { computeAllTurnPlans, computeTurnPlan, FALLBACK_ODDS, TARGET_ODDS } from "./turnPlan";

const ctx = createSimContext(DEFAULT_LEAGUE, dataset.players);
const room = defaultRoom(12);
const start: DraftPick[] = [{ playerId: "jahmyr-gibbs-rb-det", mine: true }];
const odds = survivalOdds(start, room, ctx, { n: 300, rng: mulberry32(2026) });
const id = (name: string) => dataset.players.find((p) => p.name === name)!.id;

describe("survivalOdds", () => {
  it("reports the user's remaining turns and skips taken players", () => {
    expect(odds.turns.slice(0, 3)).toEqual([[24, 25], [48, 49], [72, 73]]);
    expect(odds.players.has("jahmyr-gibbs-rb-det")).toBe(false);
    expect(odds.players.size).toBe(dataset.players.length - 1);
  });

  it("availability never increases at later turns", () => {
    for (const o of odds.players.values()) {
      o.available.forEach((a, j) => j > 0 && expect(a).toBeLessThanOrEqual(o.available[j - 1]));
    }
  });

  it("is directionally right: early ADP gone, ADP-buried players survive", () => {
    // Bijan (ADP 2) is never there at 24.
    expect(survival(odds.players.get(id("Bijan Robinson"))!, 0)).toBe(0);
    // Chris Godwin: experts 82, ESPN ADP 128 — the prototype's "biggest discount". Usually there in round 5.
    expect(survival(odds.players.get(id("Chris Godwin"))!, 3)).toBeGreaterThan(0.7);
    // Travis Hunter: ESPN 91 vs experts 200. Casual drafters take him long before his expert rank.
    expect(survival(odds.players.get(id("Travis Hunter"))!, 5)).toBeLessThan(0.5);
  });

  it("runs 300 mocks for a 12-team league in under 2 seconds", () => {
    const run = survivalOdds([], room, ctx, { n: 300, rng: mulberry32(1) });
    console.info(`survivalOdds: 300 mocks, 12 teams, ${Math.round(run.elapsedMs)} ms`);
    expect(run.elapsedMs).toBeLessThan(2000);
  });

  it("has no turns left once the user's picks are done", () => {
    const full = simulateFrom([], room, ctx, { autoMe: true, rng: mulberry32(5) });
    const done = survivalOdds(full.slice(0, 191), room, ctx, { n: 5, rng: mulberry32(5) });
    expect(done.turns).toEqual([[192]]);
    expect(survivalOdds(full, room, ctx, { n: 5, rng: mulberry32(5) }).turns).toEqual([]);
  });
});

describe("computeTurnPlan", () => {
  const plan = computeTurnPlan(start, odds, ctx)!;

  it("splits the needs-adjusted board by survival odds", () => {
    expect(plan.picks).toEqual([24, 25]);
    expect(plan.targets).toHaveLength(4);
    expect(plan.fallbacks).toHaveLength(4);
    plan.targets.forEach((e) => expect(e.survival).toBeGreaterThanOrEqual(TARGET_ODDS));
    plan.fallbacks.forEach((e) => expect(e.survival).toBeGreaterThanOrEqual(FALLBACK_ODDS));
    expect(plan.letGo.length).toBeGreaterThan(0);
    expect(plan.letGo.length).toBeLessThanOrEqual(3);
    plan.letGo.forEach((e) => {
      expect(e.survival).toBeLessThan(FALLBACK_ODDS);
      expect(e.player.consensusRank).toBeGreaterThanOrEqual(24 - 6);
    });
  });

  it("resembles the prototype's hand-written plan for picks 24/25", () => {
    const names = (entries: { player: { name: string } }[]) => entries.map((e) => e.player.name);
    // Prototype targets: Nico Collins, A.J. Brown, Malik Nabers, George Pickens.
    const planned = [...names(plan.targets), ...names(plan.fallbacks)];
    expect(planned.filter((n) => ["Nico Collins", "A.J. Brown", "Malik Nabers", "George Pickens"].includes(n)).length).toBeGreaterThanOrEqual(2);
    // Prototype "let go": Drake London, Rashee Rice, Jeremiyah Love — never targets here.
    expect(names(plan.targets)).not.toEqual(expect.arrayContaining(["Drake London"]));
    expect(names(plan.targets)).not.toEqual(expect.arrayContaining(["Rashee Rice"]));
  });

  it("never plans around taken players", () => {
    const all = [...plan.targets, ...plan.fallbacks, ...plan.letGo].map((e) => e.player.id);
    expect(all).not.toContain("jahmyr-gibbs-rb-det");
    expect(new Set(all).size).toBe(all.length);
  });

  it("when on the clock, targets and fallbacks are simply the best available, in order", () => {
    const toMe = simulateFrom(start, room, ctx, { autoMe: false, rng: mulberry32(9) });
    expect(toMe).toHaveLength(23);
    const now = computeTurnPlan(toMe, survivalOdds(toMe, room, ctx, { n: 50, rng: mulberry32(9) }), ctx)!;
    expect(now.picks).toEqual([24, 25]);
    expect(now.targets).toHaveLength(4);
    expect(now.fallbacks).toHaveLength(4);
    [...now.targets, ...now.fallbacks].forEach((e) => expect(e.survival).toBe(1));
    expect(now.letGo).toEqual([]);
  });

  it("builds a plan for each remaining turn", () => {
    const plans = computeAllTurnPlans(start, odds, ctx);
    expect(plans.map((p) => p.picks)).toEqual(odds.turns);
  });

  it("returns null for a turn that doesn't exist", () => {
    expect(computeTurnPlan(start, odds, ctx, 99)).toBeNull();
  });
});
