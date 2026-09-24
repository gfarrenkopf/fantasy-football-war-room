import { describe, expect, it } from "vitest";
import { lineupEmphasis, tradeEmphasis } from "./emphasis";

describe("emphasis", () => {
  it("scales a lineup gain from rest to must", () => {
    expect([0, 0.1, 2, 6, 12].map(lineupEmphasis)).toEqual(["rest", "trim", "gain", "swing", "must"]);
  });

  it("scales a trade by size either way, on a tighter per-week scale", () => {
    expect([0, 0.3, 1, 3, 6].map(tradeEmphasis)).toEqual(["rest", "trim", "gain", "swing", "must"]);
    expect(tradeEmphasis(-3)).toBe("swing");
  });
});
