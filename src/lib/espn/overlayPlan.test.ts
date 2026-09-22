import { describe, expect, it } from "vitest";
import { dataset, standardRoster } from "@/lib/data";
import { createSimContext } from "@/lib/draft/sim";
import type { TurnPlan } from "@/lib/draft/sim/turnPlan";
import { buildOverlayPlan, parseOverlayPlan, type OverlayPlan } from "./overlayPlan";

const league = { teams: 12, mySlot: 3, scoring: "ppr" as const, valueThreshold: 10, roster: standardRoster() };
const ctx = createSimContext(league, dataset.players);
const byName = (name: string) => dataset.players.find((p) => p.name === name)!;
const entry = (name: string, survival: number) => ({ player: byName(name), survival });

const now: TurnPlan = { picks: [27], targets: [entry("Jahmyr Gibbs", 1), entry("Bijan Robinson", 0.72)], fallbacks: [entry("Ja'Marr Chase", 0.4)], letGo: [] };
const next: TurnPlan = { picks: [46], targets: [entry("Puka Nacua", 0.9), entry("Jonathan Taylor", 0.8)], fallbacks: [], letGo: [] };

describe("buildOverlayPlan", () => {
  const plan = buildOverlayPlan({ now, next, onClock: false, taken: new Set(["jonathan-taylor-rb-ind"]), counts: {}, current: 20, ctx, valueThreshold: 10 });

  it("carries the turn, survival badges and the turn after, skipping players already taken", () => {
    expect(plan).toMatchObject({ picks: [27], rounds: "3", onClock: false });
    expect(plan.targets.map((p) => [p.name, p.badge])).toEqual([
      ["Jahmyr Gibbs", "100%"],
      ["Bijan Robinson", "72%"],
    ]);
    expect(plan.fallbacks.map((p) => p.name)).toEqual(["Ja'Marr Chase"]);
    expect(plan.after).toEqual({ picks: [46], names: ["Puka Nacua"] });
  });

  it("adds the best players outside the plan, ranked, and none of the plan's own", () => {
    expect(plan.best.length).toBeGreaterThan(0);
    expect(plan.best.length).toBeLessThanOrEqual(4);
    expect(plan.best.every((p) => p.badge.startsWith("#"))).toBe(true);
    const planIds = new Set([...plan.targets, ...plan.fallbacks].map((p) => p.playerId));
    expect(plan.best.some((p) => planIds.has(p.playerId))).toBe(false);
  });

  it("round-trips through the server's validator", () => {
    expect(parseOverlayPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });
});

describe("parseOverlayPlan", () => {
  const valid: OverlayPlan = {
    picks: [108],
    rounds: "11",
    onClock: true,
    targets: [{ playerId: "p1", name: "Dalton Kincaid", pos: "TE", team: "BUF", bye: 7, badge: "100%", tag: { kind: "value", label: "+25 Value" } }],
    fallbacks: [],
    best: [],
    after: { picks: [113], names: ["Caleb Williams"] },
  };

  it("keeps known fields only, and never trusts an ESPN id from the client", () => {
    const parsed = parseOverlayPlan({ ...valid, extra: 1, targets: [{ ...valid.targets[0], espnPlayerId: 666, junk: true }] });
    expect(parsed).toEqual(valid);
  });

  it("rejects oversized or malformed plans", () => {
    const five = Array.from({ length: 5 }, () => valid.targets[0]);
    for (const bad of [{ ...valid, targets: five }, { ...valid, picks: [] }, { ...valid, targets: [{ ...valid.targets[0], pos: "LB" }] }, { ...valid, after: { picks: [1], names: [5] } }, null]) {
      expect(parseOverlayPlan(bad)).toBeNull();
    }
  });
});
