import { describe, expect, it } from "vitest";
import { leagueHome } from "./home";

describe("leagueHome", () => {
  it("opens a linked league's season page once its draft is done", () => {
    expect(leagueHome("abc", true, true)).toBe("/season/abc");
  });

  it("opens the draft room before the draft is done, or when the league isn't linked", () => {
    expect(leagueHome("abc", true, false)).toBe("/draft?league=abc");
    expect(leagueHome("abc", false, true)).toBe("/draft?league=abc");
    expect(leagueHome("abc", false, false)).toBe("/draft?league=abc");
  });

  it("escapes the id", () => {
    expect(leagueHome("a b", true, true)).toBe("/season/a%20b");
  });
});
