import { describe, expect, it } from "vitest";
import type { Dataset, Player } from "@/lib/draft/types";
import { diffDatasets, formatChangelog } from "./changelog";

const player = (over: Partial<Player> & Pick<Player, "id" | "name">): Player => ({
  pos: "RB",
  team: "DET",
  bye: 6,
  consensusRank: 10,
  adp: 10,
  posRank: 1,
  ...over,
});

const dataset = (players: Player[], byeWeeks: Record<string, number> = { DET: 6, BUF: 7 }): Dataset => ({
  season: 2026,
  label: "test",
  adpSource: "test",
  scoring: ["ppr"],
  byeWeeks,
  players,
});

const gibbs = player({ id: "jahmyr-gibbs-rb-det", name: "Jahmyr Gibbs" });
const cook = player({ id: "james-cook-rb-buf", name: "James Cook", team: "BUF", bye: 7, consensusRank: 20, adp: 22 });

describe("diffDatasets", () => {
  it("reports players added and dropped", () => {
    const log = diffDatasets(dataset([gibbs]), dataset([cook]));
    expect(log.added.map((p) => p.name)).toEqual(["James Cook"]);
    expect(log.dropped.map((p) => p.name)).toEqual(["Jahmyr Gibbs"]);
    expect(log.counts).toEqual({ before: 1, after: 1 });
  });

  it("reports a trade as a team change, not as add + drop", () => {
    // Player ids embed the team, so a trade silently orphans saved picks. It has to read
    // as one event, not two unrelated ones.
    const moved = player({ ...gibbs, id: "jahmyr-gibbs-rb-buf", team: "BUF", bye: 7 });
    const log = diffDatasets(dataset([gibbs]), dataset([moved]));
    expect(log.added).toEqual([]);
    expect(log.dropped).toEqual([]);
    expect(log.teamChanges).toEqual([
      { name: "Jahmyr Gibbs", fromId: gibbs.id, toId: moved.id, fromTeam: "DET", toTeam: "BUF" },
    ]);
  });

  it("reports ADP moves beyond the threshold and ignores small ones", () => {
    const nudged = player({ ...gibbs, adp: 12 });
    const jumped = player({ ...gibbs, adp: 40 });
    expect(diffDatasets(dataset([gibbs]), dataset([nudged])).adpMoves).toEqual([]);
    const log = diffDatasets(dataset([gibbs]), dataset([jumped]));
    expect(log.adpMoves).toEqual([{ id: gibbs.id, name: "Jahmyr Gibbs", from: 10, to: 40, delta: 30 }]);
  });

  it("reports consensus-rank moves separately from ADP moves", () => {
    const resorted = player({ ...gibbs, consensusRank: 45 });
    const log = diffDatasets(dataset([gibbs]), dataset([resorted]));
    expect(log.adpMoves).toEqual([]);
    expect(log.rankMoves.map((m) => m.delta)).toEqual([35]);
  });

  it("honours custom thresholds", () => {
    const nudged = player({ ...gibbs, adp: 12 });
    expect(diffDatasets(dataset([gibbs]), dataset([nudged]), { adpThreshold: 1 }).adpMoves).toHaveLength(1);
  });

  it("sorts the biggest movers first", () => {
    const before = dataset([gibbs, cook]);
    const after = dataset([player({ ...gibbs, adp: 30 }), player({ ...cook, adp: 100 })]);
    expect(diffDatasets(before, after).adpMoves.map((m) => m.name)).toEqual(["James Cook", "Jahmyr Gibbs"]);
  });

  it("reports bye-week changes for teams it already knew about", () => {
    const log = diffDatasets(dataset([gibbs], { DET: 6 }), dataset([player({ ...gibbs, bye: 9 })], { DET: 9 }));
    expect(log.byeChanges).toEqual([{ team: "DET", from: 6, to: 9 }]);
  });

  it("doesn't report a bye change for a team it hasn't seen before", () => {
    const log = diffDatasets(dataset([gibbs], { DET: 6 }), dataset([gibbs], { DET: 6, BUF: 7 }));
    expect(log.byeChanges).toEqual([]);
  });

  it("reports nothing when the datasets match", () => {
    const log = diffDatasets(dataset([gibbs, cook]), dataset([gibbs, cook]));
    expect([log.added, log.dropped, log.adpMoves, log.rankMoves, log.teamChanges, log.byeChanges]).toEqual([[], [], [], [], [], []]);
  });
});

describe("formatChangelog", () => {
  it("leads with team changes and flags what they cost", () => {
    const moved = player({ ...gibbs, id: "jahmyr-gibbs-rb-buf", team: "BUF", bye: 7 });
    const text = formatChangelog(diffDatasets(dataset([gibbs]), dataset([moved])));
    expect(text).toContain("orphan saved picks");
    expect(text).toContain("DET → BUF");
  });

  it("always reports the player count", () => {
    expect(formatChangelog(diffDatasets(dataset([gibbs]), dataset([gibbs, cook])))).toContain("players: 1 → 2");
  });

  it("truncates long sections instead of printing hundreds of lines", () => {
    const many = Array.from({ length: 30 }, (_, i) => player({ id: `p-${i}`, name: `Player ${i}` }));
    const text = formatChangelog(diffDatasets(dataset([]), dataset(many)));
    expect(text).toContain("…and 10 more");
  });
});
