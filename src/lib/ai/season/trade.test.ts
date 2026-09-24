import { describe, expect, it } from "vitest";
import { evaluateTrade, type Trade } from "@/lib/season/trade";
import { PlanModelError } from "../provider";
import { createFakePlanModel } from "../providers/fake";
import { at, player, seasonView } from "./testView";
import { buildTradeInput, buildTradePrompt, generateTradeWriteup, TRADE_OUTPUT_SCHEMA, validateTradeWriteup } from "./trade";

const myRb = at("RB", player("My Back", "RB", [12, 0, 12]));
const myWr = player("My Bench Wideout", "WR", 6);
const mine = [at("QB", player("My QB", "QB", 20)), at("RB", player("My RB1", "RB", 15)), myRb, at("WR", player("My WR1", "WR", 14)), at("WR", player("My WR2", "WR", 9)), at("TE", player("My TE", "TE", 8)), myWr];
const theirWr = at("WR", player("Their Wideout", "WR", 13, { injuryStatus: "QUESTIONABLE" }));
const theirRb = player("Their Bench Back", "RB", 7);
const theirs = [at("QB", player("Their QB", "QB", 18)), at("RB", player("Their RB1", "RB", 9)), at("RB", player("Their RB2", "RB", 8)), theirWr, at("WR", player("Their WR2", "WR", 10)), at("TE", player("Their TE", "TE", 6)), theirRb];
const view = seasonView(mine, theirs);
const trade: Trade = { teamA: 1, gives: [myRb.playerId], teamB: 2, gets: [theirWr.playerId] };
const verdict = evaluateTrade(view.teams, { ...view }, trade)!;
const input = buildTradeInput(view, trade, verdict);
const ref = (p: { playerId: number }) => input.players.find((x) => x.playerId === p.playerId)!.ref;

describe("buildTradeInput", () => {
  it("carries both sides of the verdict, byes, playoff weeks and injuries", () => {
    expect(input.you).toMatchObject({ name: "Mine", delta: Math.round(verdict.a.delta * 10) / 10 });
    expect(input.them.name).toBe("Theirs");
    expect(input.players.find((p) => p.ref === ref(myRb))).toMatchObject({ side: "you", moving: true, byes: [6], playoffs: 12 });
    expect(input.players.find((p) => p.ref === ref(theirWr))).toMatchObject({ side: "them", moving: true, injury: "questionable" });
    expect(input.players.filter((p) => p.moving)).toHaveLength(2);
  });

  it("builds a prompt with the trade and both rosters", () => {
    const { user } = buildTradePrompt(input);
    expect(user).toContain(`you send My Back [${ref(myRb)}]; you get Their Wideout [${ref(theirWr)}]`);
    expect(user).toContain("Playoffs: weeks 7-7.");
    expect(user).toContain("## Their roster");
  });
});

describe("validateTradeWriteup", () => {
  const base = { lean: "counter", summary: "Close, but ask for more.", reasons: ["One.", "Two."], counter: { give: [ref(myRb)], get: [ref(theirWr), ref(theirRb)], note: "Add their bench back." } };

  it("keeps a counter-offer as player ids", () => {
    const result = validateTradeWriteup(base, input);
    expect(result).toEqual({
      ok: true,
      issues: [],
      writeup: { lean: "counter", summary: "Close, but ask for more.", reasons: ["One.", "Two."], counter: { give: [myRb.playerId], get: [theirWr.playerId, theirRb.playerId], note: "Add their bench back." } },
    });
  });

  it("rejects a write-up that names a player not in the input", () => {
    expect(validateTradeWriteup({ ...base, counter: { give: ["p99"], get: [], note: "" } }, input)).toEqual({ ok: false, issues: ['names "p99", which isn\'t in the input'] });
  });

  it("drops a counter with players on the wrong side, and an empty one", () => {
    const wrong = validateTradeWriteup({ ...base, counter: { give: [ref(theirRb)], get: [], note: "" } }, input);
    expect(wrong.ok && wrong.writeup.counter).toBeNull();
    expect(wrong.issues).toEqual(["dropped a counter with players on the wrong side"]);
    const none = validateTradeWriteup({ ...base, lean: "accept", counter: { give: [], get: [], note: "" } }, input);
    expect(none.ok && none.writeup).toMatchObject({ lean: "accept", counter: null });
  });

  it("rejects an unknown lean or an empty summary", () => {
    expect(validateTradeWriteup({ ...base, lean: "maybe" }, input).ok).toBe(false);
    expect(validateTradeWriteup({ ...base, summary: " " }, input).ok).toBe(false);
  });
});

describe("generateTradeWriteup", () => {
  it("asks for the trade schema and returns the validated write-up", async () => {
    const model = createFakePlanModel(() => ({ json: { lean: "accept", summary: "Take it.", reasons: [], counter: { give: [], get: [], note: "" } }, usage: { inputTokens: 1500, outputTokens: 200 } }));
    const result = await generateTradeWriteup(model, input);
    expect(model.calls[0].schema).toBe(TRADE_OUTPUT_SCHEMA);
    expect(result.writeup).toEqual({ lean: "accept", summary: "Take it.", reasons: [], counter: null });
  });

  it("throws invalid_output for an unusable response", async () => {
    const model = createFakePlanModel(() => ({ json: { lean: "accept" }, usage: { inputTokens: 1, outputTokens: 1 } }));
    await expect(generateTradeWriteup(model, input)).rejects.toBeInstanceOf(PlanModelError);
  });
});
