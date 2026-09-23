import { describe, expect, it } from "vitest";
import { seedPremiered, shouldPremiere } from "./premiere";

describe("seedPremiered", () => {
  it("counts every league already on the device as premiered", () => {
    expect(seedPremiered(["a", "b"], null)).toEqual(["a", "b"]);
  });

  it("leaves out the league the landing page just made", () => {
    expect(seedPremiered(["a", "b"], "b")).toEqual(["a"]);
  });

  it("seeds an empty list on a device with no leagues yet", () => {
    expect(seedPremiered([], null)).toEqual([]);
  });
});

describe("shouldPremiere", () => {
  it("runs for a new league with no picks", () => {
    expect(shouldPremiere(["a"], "b", 0)).toBe(true);
  });

  it("never runs twice for the same league", () => {
    expect(shouldPremiere(["a", "b"], "b", 0)).toBe(false);
  });

  it("skips a league that already has picks", () => {
    expect(shouldPremiere([], "b", 3)).toBe(false);
  });
});
