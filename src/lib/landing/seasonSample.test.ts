import { describe, expect, it } from "vitest";
import { seasonSample } from "./sample";
import { callsWorth, draftRoomLineup, landingMode, lineupTotal, validateSeasonSample } from "./seasonSample";

const window = { start: "2026-09-10T00:20:00.000Z", end: "2027-01-08T01:15:00.000Z" };
const at = (iso: string) => Date.parse(iso);

describe("landingMode", () => {
  it("follows the season window on auto", () => {
    expect(landingMode("auto", true, at("2026-08-20T12:00:00Z"), window)).toBe("draft");
    expect(landingMode("auto", true, at("2026-09-10T00:20:00Z"), window)).toBe("season");
    expect(landingMode("auto", true, at("2026-10-09T12:00:00Z"), window)).toBe("season");
    expect(landingMode("auto", true, at("2027-01-08T01:15:00Z"), window)).toBe("draft");
  });

  it("lets the override force either page", () => {
    expect(landingMode("season", true, at("2026-07-01T00:00:00Z"), window)).toBe("season");
    expect(landingMode("draft", true, at("2026-10-09T12:00:00Z"), window)).toBe("draft");
  });

  it("shows the draft page whenever in-season features are off", () => {
    expect(landingMode("auto", false, at("2026-10-09T12:00:00Z"), window)).toBe("draft");
    expect(landingMode("season", false, at("2026-10-09T12:00:00Z"), window)).toBe("draft");
  });
});

describe("the committed season sample", () => {
  it("is valid", () => {
    expect(() => validateSeasonSample(JSON.parse(JSON.stringify(seasonSample)))).not.toThrow();
  });

  it("tells the page's story: Draft Room's lineup projects more, and flips the matchup", () => {
    const byRank = lineupTotal(seasonSample.lineup);
    const ours = lineupTotal(draftRoomLineup(seasonSample));
    expect(ours).toBeGreaterThan(byRank);
    expect(byRank).toBeLessThan(seasonSample.opponentProj);
    expect(ours).toBeGreaterThan(seasonSample.opponentProj);
  });

  it("wins the week on Draft Room's calls: set by rank, it's a loss", () => {
    const { you, opponent } = seasonSample.final;
    expect(you - callsWorth(seasonSample.swaps)).toBeLessThan(opponent);
  });

  it("swaps a bench player in for the starter it replaces, at the same position", () => {
    for (const swap of seasonSample.swaps) {
      expect(seasonSample.lineup[swap.slot].player).toEqual(swap.out);
      expect(seasonSample.bench).toContainEqual(swap.in);
      expect(swap.in.proj).toBeGreaterThan(swap.out.proj);
    }
  });

  it("trades one for two in your favor, so the side you get reads as the better one", () => {
    expect(seasonSample.trade.get.length).toBeGreaterThan(seasonSample.trade.send.length);
  });

  it("trades away bench players only, and drops a bench player who isn't in the trade", () => {
    for (const p of seasonSample.trade.send) expect(seasonSample.bench).toContainEqual(p);
    expect(seasonSample.bench).toContainEqual(seasonSample.waiver.drop);
    expect(seasonSample.trade.send).not.toContainEqual(seasonSample.waiver.drop);
  });
});

describe("validateSeasonSample", () => {
  it("rejects a sample whose final isn't a win", () => {
    const lost = { ...JSON.parse(JSON.stringify(seasonSample)), final: { you: 90, opponent: 100 } };
    expect(() => validateSeasonSample(lost)).toThrow(/win/);
  });

  it("rejects swaps that don't decide the week", () => {
    const raw = JSON.parse(JSON.stringify(seasonSample));
    for (const sw of raw.swaps) sw.points = { in: 10, out: 9.9 };
    expect(() => validateSeasonSample(raw)).toThrow(/margin/);
  });

  it("rejects win chances that don't cross 50%", () => {
    const flat = { ...JSON.parse(JSON.stringify(seasonSample)), winChance: { before: 0.6, after: 0.7 } };
    expect(() => validateSeasonSample(flat)).toThrow(/50%/);
  });
});
