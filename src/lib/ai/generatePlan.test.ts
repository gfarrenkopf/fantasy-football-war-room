import { describe, expect, it } from "vitest";
import { dataset, DEFAULT_LEAGUE } from "@/lib/data";
import { mulberry32 } from "@/lib/draft/sim";
import { generateAiPlan } from "./generatePlan";
import { buildPlanInput, type PlanInput } from "./planInput";
import { validateAiPlan } from "./planSchema";
import { PlanModelError } from "./provider";
import { createFakePlanModel } from "./providers/fake";

const input = buildPlanInput(DEFAULT_LEAGUE, dataset, { n: 50, rng: mulberry32(7) });
const usage = { inputTokens: 100, outputTokens: 50 };

/** A response that simply agrees with the engine: the shape a real model is asked for. */
function engineResponse(from: PlanInput) {
  const refs = (turn: PlanInput["turns"][number], bucket: string) => turn.candidates.filter((c) => c.engine === bucket).map((c) => c.ref);
  return {
    intro: "Think in pairs.",
    turns: from.turns.map((t) => ({
      pick: t.picks[0],
      open: "",
      note: "Why.",
      take: refs(t, "target").slice(0, t.picks.length),
      targets: refs(t, "target"),
      fallbacks: refs(t, "fallback"),
      letGo: refs(t, "letGo"),
    })),
  };
}

const idOf = (ref: string) => input.refs.get(ref)!;

describe("validateAiPlan", () => {
  it("accepts a well-formed plan and maps refs to player ids", () => {
    const result = validateAiPlan(engineResponse(input), input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.filter((i) => !i.startsWith("roster:"))).toEqual([]);
    expect(result.plan.turns.map((t) => t.picks)).toEqual(input.turns.map((t) => t.picks));
    expect(result.plan.turns[0].targets[0]).toMatch(/-rb-|-wr-|-qb-|-te-/);
    expect(result.plan.turns[1].take).toHaveLength(2);
  });

  it("drops refs that weren't offered for that turn, repeats, and overlong lists", () => {
    const raw = engineResponse(input);
    const second = raw.turns[1];
    const offered = input.turns[1].candidates.map((c) => c.ref);
    second.targets = ["p9999", offered[0], offered[0], offered[1], offered[2], offered[3], offered[4]];
    const result = validateAiPlan(raw, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.turns[1].targets).toEqual(offered.slice(0, 4).map(idOf));
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "picks 24 & 25: targets cites p9999, which wasn't offered",
        `picks 24 & 25: targets repeats ${offered[0]}`,
        `picks 24 & 25: targets over 4, dropped ${offered[4]}`,
      ]),
    );
  });

  it("accepts bracketed refs and exact names of offered players", () => {
    const raw = engineResponse(input);
    const [a, b] = input.turns[1].candidates;
    raw.turns[1].targets = [`[${a.ref}]`, b.player.name.toUpperCase(), input.turns[0].candidates[0].player.name];
    const result = validateAiPlan(raw, input);
    expect(result.ok && result.plan.turns[1].targets).toEqual([a.player.id, b.player.id]);
    expect(result.issues).toContain(`picks 24 & 25: targets cites ${input.turns[0].candidates[0].player.name}, which wasn't offered`);
  });

  it("drops a turn with no valid targets, and a missing turn, but keeps the rest", () => {
    const raw = engineResponse(input);
    raw.turns[2].targets = ["nope"];
    raw.turns.splice(3, 1);
    const result = validateAiPlan(raw, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.turns.map((t) => t.picks[0])).not.toContain(48);
    expect(result.plan.turns.map((t) => t.picks[0])).not.toContain(72);
    expect(result.plan.turns).toHaveLength(input.turns.length - 2);
    expect(result.issues).toEqual(expect.arrayContaining(["picks 48 & 49: no valid targets, turn dropped", "picks 72 & 73: missing"]));
  });

  it("rejects take entries beyond one per pick, or drafted at an earlier turn", () => {
    const raw = engineResponse(input);
    const offered = input.turns[0].candidates.map((c) => c.ref);
    raw.turns[0].take = [offered[0], offered[1]];
    const later = input.turns.findIndex((t, i) => i > 0 && t.candidates.some((c) => c.ref === offered[0]));
    if (later > 0) raw.turns[later].take = [offered[0]];
    const result = validateAiPlan(raw, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.turns[0].take).toEqual([idOf(offered[0])]);
    expect(result.issues).toContain(`picks 1: take over 1, dropped ${offered[1]}`);
    if (later > 0) expect(result.issues).toContain(`picks ${input.turns[later].picks.join(" & ")}: take ${offered[0]} was already drafted earlier`);
  });

  it("fills an empty starting slot by swapping out a redundant late pick", () => {
    const raw = engineResponse(input);
    const refPos = new Map(input.turns.flatMap((t) => t.candidates.map((c) => [c.ref, c.player.pos] as const)));
    // Take no kicker anywhere, and two D/STs at picks 168 & 169.
    for (const t of raw.turns) t.take = t.take.filter((r) => refPos.get(r) !== "K");
    const late = input.turns.findIndex((t) => t.picks[0] === 168);
    const dsts = input.turns[late].candidates.filter((c) => c.player.pos === "DST" && c.odds >= 0.3).map((c) => c.ref);
    raw.turns[late].take = dsts.slice(0, 2);
    raw.turns[late].targets = dsts.slice(0, 2);
    for (const t of raw.turns.slice(late + 1)) t.take = t.take.filter((r) => refPos.get(r) !== "DST");

    const result = validateAiPlan(raw, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kicker = input.turns[late].candidates.find((c) => c.player.pos === "K" && c.odds >= 0.3)!;
    const turn = result.plan.turns.find((t) => t.picks[0] === 168)!;
    expect(turn.take).toEqual([idOf(dsts[0]), kicker.player.id]);
    expect(turn.targets[0]).toBe(kicker.player.id);
    expect(result.issues).toContain(`roster: picks 168 & 169 takes ${kicker.ref} instead of ${dsts[1]} to fill the empty K slot`);
    expect(result.issues.some((i) => i.startsWith("roster: 0 K"))).toBe(false);
  });

  it("reports a starting slot it can't fill", () => {
    const noKickers: PlanInput = { ...input, turns: input.turns.map((t) => ({ ...t, candidates: t.candidates.filter((c) => c.player.pos !== "K") })) };
    const result = validateAiPlan(engineResponse(noKickers), noKickers);
    expect(result.issues).toContain("roster: 0 K for 1 starting slot");
  });

  it("fills a short take list from the targets", () => {
    const raw = engineResponse(input);
    raw.turns[1].take = [];
    const result = validateAiPlan(raw, input);
    expect(result.ok && result.plan.turns[1].take).toEqual(raw.turns[1].targets.slice(0, 2).map(idOf));
    expect(result.issues).toContain(`picks 24 & 25: take had 1 of 2, added target ${raw.turns[1].targets[1]}`);
  });

  it("drops let-go players who will likely be there, or were targeted earlier", () => {
    const raw = engineResponse(input);
    const safe = input.turns[1].candidates.find((c) => c.odds >= 0.3)!;
    raw.turns[1].letGo = [safe.ref];
    const targetedThenGone = input.turns.findIndex((t, i) => i > 0 && t.candidates.some((c) => c.odds < 0.3 && raw.turns[i - 1].targets.includes(c.ref)));
    const result = validateAiPlan(raw, input);
    expect(result.ok && result.plan.turns[1].letGo).toEqual([]);
    expect(result.issues).toContain(`picks 24 & 25: letGo ${safe.ref} has ${Math.round(safe.odds * 100)}% odds`);
    if (targetedThenGone < 0) return;
    const t = input.turns[targetedThenGone];
    const c = t.candidates.find((x) => x.odds < 0.3 && raw.turns[targetedThenGone - 1].targets.includes(x.ref))!;
    raw.turns[targetedThenGone].letGo = [c.ref];
    expect(validateAiPlan(raw, input).issues).toContain(`picks ${t.picks.join(" & ")}: letGo ${c.ref} was planned earlier`);
  });

  it("fails on the wrong shape or when nothing survives", () => {
    expect(validateAiPlan("plan", input).ok).toBe(false);
    expect(validateAiPlan({ intro: "x", turns: [] }, input)).toEqual({ ok: false, issues: expect.arrayContaining(["no usable turns"]) });
  });

  it("trims and caps free text", () => {
    const raw = engineResponse(input);
    raw.intro = `  ${"x".repeat(5000)}  `;
    const result = validateAiPlan(raw, input);
    expect(result.ok && result.plan.intro.length).toBe(1200);
  });
});

describe("generateAiPlan", () => {
  it("sends the prompt and schema to the model and returns the validated plan", async () => {
    const model = createFakePlanModel(() => ({ json: engineResponse(input), usage }));
    const generated = await generateAiPlan(model, input);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].user).toContain("## picks 24 & 25");
    expect(model.calls[0]).toMatchObject({ effort: "medium", maxTokens: 32_000 });
    expect(model.calls[0].schema).toMatchObject({ type: "object", required: ["intro", "turns"] });
    expect(generated).toMatchObject({ provider: "fake", model: "fake-1", usage });
    expect(generated.issues.filter((i) => !i.startsWith("roster:"))).toEqual([]);
    expect(generated.plan.turns).toHaveLength(input.turns.length);
  });

  it("throws invalid_output, with the tokens spent, when nothing usable comes back", async () => {
    const model = createFakePlanModel(() => ({ json: { intro: "", turns: [] }, usage }));
    const error = await generateAiPlan(model, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlanModelError);
    expect(error).toMatchObject({ kind: "invalid_output", usage });
  });

  it("passes provider errors through", async () => {
    const model = createFakePlanModel(() => {
      throw new PlanModelError("timeout", "slow");
    });
    await expect(generateAiPlan(model, input)).rejects.toMatchObject({ kind: "timeout" });
  });
});
