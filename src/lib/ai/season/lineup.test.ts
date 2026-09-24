import { describe, expect, it } from "vitest";
import { createFakePlanModel } from "../providers/fake";
import { PlanModelError } from "../provider";
import { buildLineupInput, buildLineupPrompt, generateAiLineup, LINEUP_OUTPUT_SCHEMA, validateAiLineup } from "./lineup";
import { at, player, seasonView } from "./testView";

// Engine: QB 20, RBs 15 + 12, WRs 14 + 11, TE 8, and Gibbs (11, questionable) at FLEX over Flex (10).
const qb = at("QB", player("Quarterback", "QB", 20));
const rbA = at("RB", player("Runner A", "RB", 15));
const rbB = at("RB", player("Runner B", "RB", 12));
const wrC = at("WR", player("Wideout C", "WR", 14));
const wrD = at("WR", player("Wideout D", "WR", 11));
const te = at("TE", player("Tight End", "TE", 8));
const flex = at("FLEX", player("Flex Wideout", "WR", 10));
const gibbs = player("Gibbs", "RB", 11, { injuryStatus: "QUESTIONABLE" });
const out = player("Out Back", "RB", 13, { injuryStatus: "OUT" });
const view = seasonView([qb, rbA, rbB, wrC, wrD, te, flex, gibbs, out]);
const input = buildLineupInput(view);
const ref = (p: { playerId: number }) => input.players.find((x) => x.playerId === p.playerId)!.ref;
const slot = (key: string, n = 0) => input.slots.filter((s) => s.key === key)[n];

describe("buildLineupInput", () => {
  it("offers close calls, and never a ruled-out player", () => {
    expect(slot("FLEX")).toMatchObject({ engine: ref(gibbs), options: [ref(gibbs), ref(flex)], decide: true });
    expect(slot("WR", 1)).toMatchObject({ engine: ref(wrD), options: [ref(wrD), ref(flex)], decide: true });
    expect(slot("QB")).toMatchObject({ options: [ref(qb)], decide: false });
    expect(input.slots.flatMap((s) => s.options)).not.toContain(ref(out));
    expect(input.players.find((p) => p.ref === ref(gibbs))!.injury).toBe("questionable");
  });

  it("builds a prompt that lists the decisions", () => {
    const { user } = buildLineupPrompt(input);
    expect(user).toContain(`Return calls for: ${slot("WR", 1).ref}, ${slot("FLEX").ref}.`);
    expect(user).toContain("Gibbs, RB DET | 11.0 pts");
  });
});

describe("validateAiLineup", () => {
  it("lets the model call a close one the other way", () => {
    const result = validateAiLineup(
      {
        intro: "Sit Gibbs.",
        calls: [
          { slot: slot("WR", 1).ref, ref: ref(wrD), reason: "Higher projection." },
          { slot: slot("FLEX").ref, ref: ref(flex), reason: "Gibbs is questionable and only a point better." },
        ],
      },
      input,
    );
    expect(result.ok && result.issues).toEqual([]);
    if (!result.ok) return;
    const flexSlot = result.lineup.slots.find((s) => s.key === "FLEX")!;
    expect(flexSlot).toEqual({ key: "FLEX", playerId: flex.playerId, enginePlayerId: gibbs.playerId, locked: false, reason: "Gibbs is questionable and only a point better." });
    expect(result.lineup.total).toBe(view.lineup.total - 1);
  });

  it("rejects a response that names a player not in the input", () => {
    expect(validateAiLineup({ intro: "", calls: [{ slot: slot("FLEX").ref, ref: "p99", reason: "" }] }, input)).toEqual({ ok: false, issues: ['names "p99", which isn\'t in the input'] });
    expect(validateAiLineup({ intro: "", calls: [{ slot: "s42", ref: ref(flex), reason: "" }] }, input).ok).toBe(false);
  });

  it("keeps the engine's pick for a start outside the options, or a player started twice", () => {
    const notAnOption = validateAiLineup({ intro: "", calls: [{ slot: slot("FLEX").ref, ref: ref(out), reason: "x" }] }, input);
    expect(notAnOption.ok && notAnOption.lineup.slots.find((s) => s.key === "FLEX")!.playerId).toBe(gibbs.playerId);
    expect(notAnOption.issues).toContain(`${slot("FLEX").ref}: ${ref(out)} isn't an option there; kept the engine's pick`);

    const twice = validateAiLineup(
      {
        intro: "",
        calls: [
          { slot: slot("WR", 1).ref, ref: ref(flex), reason: "a" },
          { slot: slot("FLEX").ref, ref: ref(flex), reason: "b" },
        ],
      },
      input,
    );
    if (!twice.ok) throw new Error("expected a lineup");
    expect(twice.lineup.slots.find((s) => s.key === "FLEX")!.playerId).toBe(gibbs.playerId);
    expect(twice.lineup.slots.filter((s) => s.key === "WR")[1].playerId).toBe(flex.playerId);
    expect(new Set(twice.lineup.slots.map((s) => s.playerId)).size).toBe(twice.lineup.slots.length);
  });

  it("keeps the engine's pick, without a reason, for a decision the model skipped", () => {
    const result = validateAiLineup({ intro: "Fine.", calls: [] }, input);
    expect(result.ok && result.lineup.slots.map((s) => s.playerId)).toEqual(view.lineup.starters.map((s) => s.playerId));
    expect(result.issues).toHaveLength(2);
  });
});

describe("generateAiLineup", () => {
  it("asks for the lineup schema and returns the validated lineup", async () => {
    const model = createFakePlanModel(() => ({ json: { intro: "Start Gibbs.", calls: [] }, usage: { inputTokens: 900, outputTokens: 120 } }));
    const result = await generateAiLineup(model, input);
    expect(model.calls[0].schema).toBe(LINEUP_OUTPUT_SCHEMA);
    expect(result).toMatchObject({ provider: "fake", model: "fake-1", usage: { inputTokens: 900, outputTokens: 120 }, lineup: { intro: "Start Gibbs." } });
  });

  it("throws invalid_output, with the usage spent, for an unusable response", async () => {
    const model = createFakePlanModel(() => ({ json: { intro: "", calls: [{ slot: "s1", ref: "p99", reason: "" }] }, usage: { inputTokens: 900, outputTokens: 50 } }));
    const err = await generateAiLineup(model, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanModelError);
    expect(err).toMatchObject({ kind: "invalid_output", usage: { outputTokens: 50 } });
  });
});
