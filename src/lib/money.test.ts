import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("converts minor units by the currency's decimals", () => {
    expect(formatMoney(999, "usd", "en-US")).toBe("$9.99");
    expect(formatMoney(1500, "eur", "en-US")).toBe("€15.00");
    expect(formatMoney(1000, "jpy", "en-US")).toBe("¥1,000");
  });

  it("falls back to the raw amount for an unknown currency", () => {
    expect(formatMoney(999, "zz", "en-US")).toBe("999 ZZ");
  });
});
