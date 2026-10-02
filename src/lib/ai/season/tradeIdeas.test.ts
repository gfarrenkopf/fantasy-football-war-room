import { describe, expect, it } from "vitest";
import { evaluateTrade, type Trade } from "@/lib/season/trade";
import type { TradeCandidate } from "@/lib/season/tradeIdeas";
import { PlanModelError } from "../provider";
import { createFakePlanModel } from "../providers/fake";
import { at, player, seasonView } from "./testView";
import { buildTradeIdeasInput, buildTradeIdeasPrompt, generateTradeIdeas, TRADE_IDEAS_OUTPUT_SCHEMA, validateTradeIdeas } from "./tradeIdeas";

const myRb = at("RB", player("My Back", "RB", [12, 0, 12]));
const myWr = player("My Bench Wideout", "WR", 6);
const mine = [at("QB", player("My QB", "QB", 20)), at("RB", player("My RB1", "RB", 15)), myRb, at("WR", player("My WR1", "WR", 14)), at("WR", player("My WR2", "WR", 9)), at("TE", player("My TE", "TE", 8)), myWr];
const theirWr = at("WR", player("Their Wideout", "WR", 13, { injuryStatus: "QUESTIONABLE" }));
const theirRb = player("Their Bench Back", "RB", 7);
const theirQb = player("Their QB", "QB", 18);
const theirs = [at("QB", theirQb), at("RB", player("Their RB1", "RB", 9)), at("RB", player("Their RB2", "RB", 8)), theirWr, at("WR", player("Their WR2", "WR", 10)), at("TE", player("Their TE", "TE", 6)), theirRb];
const view = seasonView(mine, theirs);

const candidate = (kind: TradeCandidate["kind"], trade: Trade): TradeCandidate => {
  const v = evaluateTrade(view.teams, view, trade)!;
  return { kind, trade, you: v.a.perWeek, them: v.b.perWeek, weeks: v.weeks };
};
const safe = candidate("safe", { teamA: 1, gives: [myWr.playerId], teamB: 2, gets: [theirRb.playerId] });
const bold = candidate("bold", { teamA: 1, gives: [myRb.playerId], teamB: 2, gets: [theirWr.playerId] });
const input = buildTradeIdeasInput(view, { safe: [safe], bold: [bold] });
const ref = (p: { playerId: number }) => input.players.find((x) => x.playerId === p.playerId)!.ref;
const answer = { safe: { pick: "s1", why: "A free upgrade at RB depth.", pitch: "You need a wideout more than a fourth back." }, bold: { pick: "b1", why: "Plus a lot.", pitch: "Your WR room gets a body." } };

describe("buildTradeIdeasInput", () => {
  it("lists each candidate with both sides' grades, and only the user's roster and the players they'd get", () => {
    expect(input.candidates.map((c) => c.id)).toEqual(["s1", "b1"]);
    expect(input.candidates[1]).toMatchObject({ kind: "bold", partner: { id: 2, name: "Theirs" }, send: [ref(myRb)], get: [ref(theirWr)] });
    expect(input.candidates[1].you.perWeek).toBeCloseTo(Math.round(bold.you * 10) / 10);
    expect(input.players.filter((p) => !p.mine).map((p) => p.playerId).sort()).toEqual([theirWr.playerId, theirRb.playerId].sort());
    expect(input.players.some((p) => p.playerId === theirQb.playerId)).toBe(false);
    expect(input.players.find((p) => p.playerId === theirWr.playerId)).toMatchObject({ injury: "questionable" });
  });

  it("builds a prompt with both lists under the candidates marker, never the trade write-up's", () => {
    const { user } = buildTradeIdeasPrompt(input);
    expect(user).toContain("## Candidates");
    expect(user).toContain(`### b1: with Theirs (0-4, 350 points for, seed 10)`);
    expect(user).toContain(`you send My Back [${ref(myRb)}]; you get Their Wideout [${ref(theirWr)}]`);
    expect(user).not.toContain("The trade:");
  });

  it("says when a list is empty", () => {
    const { user } = buildTradeIdeasPrompt(buildTradeIdeasInput(view, { safe: [safe], bold: [] }));
    expect(user).toMatch(/Bold:\n {2}none/);
  });
});

describe("validateTradeIdeas", () => {
  it("maps each pick back to the engine's trade and numbers", () => {
    const result = validateTradeIdeas(answer, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ideas.missing).toEqual([]);
    expect(result.ideas.ideas.map((i) => i.kind)).toEqual(["safe", "bold"]);
    expect(result.ideas.ideas[1]).toMatchObject({ partner: 2, gives: [myRb.playerId], gets: [theirWr.playerId], why: "Plus a lot.", found: { weeks: 3 } });
    expect(result.ideas.ideas[1].found.you).toBeCloseTo(Math.round(bold.you * 10) / 10);
    expect(result.ideas.ideas[1].names).toEqual({ [myRb.playerId]: "My Back", [theirWr.playerId]: "Their Wideout" });
  });

  it("rejects a pick that isn't a candidate, or comes from the other list", () => {
    expect(validateTradeIdeas({ ...answer, safe: { ...answer.safe, pick: "s9" } }, input)).toEqual({ ok: false, issues: [expect.stringContaining('"s9"')] });
    expect(validateTradeIdeas({ ...answer, safe: { ...answer.safe, pick: "b1" } }, input).ok).toBe(false);
  });

  it("rejects a list with candidates and no pick, or no reason", () => {
    expect(validateTradeIdeas({ ...answer, bold: { pick: "", why: "", pitch: "" } }, input).ok).toBe(false);
    expect(validateTradeIdeas({ ...answer, bold: { ...answer.bold, why: "  " } }, input).ok).toBe(false);
    expect(validateTradeIdeas("nope", input).ok).toBe(false);
  });

  it("marks an empty list as missing and ignores a pick for it", () => {
    const one = buildTradeIdeasInput(view, { safe: [safe], bold: [] });
    const result = validateTradeIdeas(answer, one);
    expect(result).toMatchObject({ ok: true, ideas: { missing: ["bold"] }, issues: ["ignored a bold pick with no bold candidates"] });
    if (result.ok) expect(result.ideas.ideas).toHaveLength(1);
  });

  it("clips long text", () => {
    const result = validateTradeIdeas({ ...answer, safe: { pick: "s1", why: "w".repeat(900), pitch: "p".repeat(900) } }, input);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ideas.ideas[0].why).toHaveLength(400);
    expect(result.ideas.ideas[0].pitch).toHaveLength(300);
  });
});

describe("generateTradeIdeas", () => {
  it("asks for the ideas schema and returns the validated set", async () => {
    const model = createFakePlanModel(() => ({ json: answer, usage: { inputTokens: 2000, outputTokens: 200 } }));
    const result = await generateTradeIdeas(model, input);
    expect(model.calls[0].schema).toBe(TRADE_IDEAS_OUTPUT_SCHEMA);
    expect(result.ideas.ideas).toHaveLength(2);
  });

  it("throws an invalid-output error for an unusable answer", async () => {
    const model = createFakePlanModel(() => ({ json: { safe: { pick: "x", why: "", pitch: "" }, bold: answer.bold }, usage: { inputTokens: 1, outputTokens: 1 } }));
    await expect(generateTradeIdeas(model, input)).rejects.toBeInstanceOf(PlanModelError);
  });
});
