import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/draft/types";
import { rankPlayers, ranksMatchAdp, replacementLevels, REPLACEMENT_STARTERS, type Rankable } from "./ranks";

const player = (id: string, pos: Position, projPoints?: number, adp = 0): Rankable => ({ id, pos, projPoints, adp });

/** n players at a position, descending from `top` points. */
const bench = (pos: Position, n: number, top: number): Rankable[] =>
  Array.from({ length: n }, (_, i) => player(`${pos.toLowerCase()}-${i}`, pos, top - i));

describe("replacementLevels", () => {
  it("uses the Nth-best player at the position, per REPLACEMENT_STARTERS", () => {
    const players = bench("RB", 40, 300);
    // RB replacement is the 30th best: 300 - 29.
    expect(replacementLevels(players).get("RB")).toBe(300 - (REPLACEMENT_STARTERS.RB - 1));
  });

  it("falls back to the worst available when a position is thinner than its starter count", () => {
    const players = bench("TE", 5, 100);
    expect(replacementLevels(players).get("TE")).toBe(96);
  });

  it("ignores players with no projection", () => {
    const players = [...bench("QB", 12, 400), player("qb-none", "QB")];
    expect(replacementLevels(players).get("QB")).toBe(400 - 11);
  });
});

describe("rankPlayers", () => {
  it("ranks by value over replacement, not raw points", () => {
    // A QB outscoring every RB on raw points, but in a deep QB pool: his edge over a
    // replacement QB is small, so he must not lead the board.
    const players = [...bench("QB", 20, 400), ...bench("RB", 40, 300)];
    const ranked = rankPlayers(players);
    expect(ranked.get("qb-0")!.consensusRank).toBeGreaterThan(1);
    expect(ranked.get("rb-0")!.consensusRank).toBe(1);
  });

  it("produces dense 1..n overall ranks", () => {
    const players = [...bench("RB", 10, 200), ...bench("WR", 10, 190)];
    const ranks = [...rankPlayers(players).values()].map((r) => r.consensusRank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("produces dense 1..n ranks within each position", () => {
    const players = [...bench("RB", 8, 200), ...bench("WR", 5, 190)];
    const ranked = rankPlayers(players);
    const posRanks = (prefix: string) =>
      players
        .filter((p) => p.id.startsWith(prefix))
        .map((p) => ranked.get(p.id)!.posRank)
        .sort((a, b) => a - b);
    expect(posRanks("rb")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(posRanks("wr")).toEqual([1, 2, 3, 4, 5]);
  });

  it("sorts players with no projection after every projected player, by ADP", () => {
    const players = [
      player("projected", "RB", 100, 200),
      player("unprojected-early", "RB", undefined, 50),
      player("unprojected-late", "RB", undefined, 150),
    ];
    const ranked = rankPlayers(players);
    expect(ranked.get("projected")!.consensusRank).toBe(1);
    expect(ranked.get("unprojected-early")!.consensusRank).toBe(2);
    expect(ranked.get("unprojected-late")!.consensusRank).toBe(3);
  });

  it("puts undrafted, unprojected players last", () => {
    const players = [player("undrafted", "WR"), player("drafted", "WR", undefined, 120)];
    const ranked = rankPlayers(players);
    expect(ranked.get("drafted")!.consensusRank).toBe(1);
    expect(ranked.get("undrafted")!.consensusRank).toBe(2);
  });

  it("is stable across runs on identical input, whatever the input order", () => {
    // Saved drafts are keyed by player id, so an unstable ranking reshuffles the board
    // between refreshes for no reason.
    const players = [...bench("RB", 12, 200), ...bench("WR", 12, 200)];
    const forwards = rankPlayers(players);
    const backwards = rankPlayers(players.slice().reverse());
    for (const p of players) {
      expect(backwards.get(p.id)).toEqual(forwards.get(p.id));
    }
  });

  it("breaks exact ties deterministically", () => {
    const tied = [player("b", "RB", 100), player("a", "RB", 100)];
    expect(rankPlayers(tied).get("a")!.consensusRank).toBe(1);
  });
});

describe("ranksMatchAdp", () => {
  it("catches consensusRank being a copy of adp", () => {
    const players = Array.from({ length: 50 }, (_, i) => ({ consensusRank: i + 1, adp: i + 1, pos: "RB" as Position }));
    expect(ranksMatchAdp(players)).toBe(true);
  });

  it("passes an independent ranking", () => {
    const players = Array.from({ length: 50 }, (_, i) => ({ consensusRank: i + 1, adp: 50 - i, pos: "RB" as Position }));
    expect(ranksMatchAdp(players)).toBe(false);
  });

  it("ignores K and D/ST, whose ranks are noise either way", () => {
    const players = Array.from({ length: 30 }, (_, i) => ({ consensusRank: i + 1, adp: i + 1, pos: "K" as Position }));
    expect(ranksMatchAdp(players)).toBe(false);
  });
});
