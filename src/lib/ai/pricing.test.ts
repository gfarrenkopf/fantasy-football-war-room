import { describe, expect, it } from "vitest";
import { costUsd, pricesFor } from "./pricing";

describe("plan model pricing", () => {
  it("prices a Sonnet 5 plan from its token usage", () => {
    // 8k input at $2/M, 2k cached at $0.20/M, 9k output at $10/M.
    expect(costUsd("anthropic", "claude-sonnet-5", { inputTokens: 8_000, cachedInputTokens: 2_000, outputTokens: 9_000 })).toBeCloseTo(0.1064, 6);
  });

  it("matches dated or suffixed model ids by prefix", () => {
    expect(pricesFor("anthropic", "claude-haiku-4-5-20251001")).toEqual({ input: 1, cachedInput: 0.1, output: 5 });
    expect(pricesFor("anthropic", "claude-fable-5-1")?.output).toBe(50);
  });

  it("leaves unknown models and providers unpriced", () => {
    expect(costUsd("anthropic", "claude-mystery-9", { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(costUsd("fake", "fake-1", { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});
