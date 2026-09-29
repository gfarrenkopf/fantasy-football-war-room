import { describe, expect, it } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { rankPickups } from "./waivers";

// Starters: QB, RB×2, WR×2, TE, FLEX, D/ST, K (testView's STARTERS); bench of three.
const mine = [
  at("QB", player("My QB", "QB", 18)),
  at("RB", player("My RB1", "RB", 14)),
  at("RB", player("My RB2", "RB", 6)),
  at("WR", player("My WR1", "WR", 13)),
  at("WR", player("My WR2", "WR", 11)),
  at("TE", player("My TE", "TE", 7)),
  at("FLEX", player("My Flex", "WR", 8)),
  at("DST", player("My D", "DST", 6)),
  at("K", player("My K", "K", 7)),
  player("Bench RB", "RB", 5),
  player("Bench WR", "WR", 4),
  player("Bench TE", "TE", 2),
];
const view = seasonView(mine);
const free = (name: string, pos: Parameters<typeof player>[1], pts: number | number[]) => ({ ...player(name, pos, pts), status: "FREEAGENT" as const, waiverClears: null });

describe("rankPickups", () => {
  const rb = free("Waiver Back", "RB", 10);
  const te = free("Waiver End", "TE", 9);
  const bench = free("Depth Wideout", "WR", 3);
  const bye = free("Bye Back", "RB", [0, 12, 12]);
  const pickups = rankPickups(view, [bench, te, rb, bye]);

  it("ranks by what each pickup adds to the best lineup, and who he'd push off the roster", () => {
    expect(pickups.map((p) => p.player.name)).toEqual(["Waiver Back", "Bye Back", "Waiver End"]);
    expect(pickups[0]).toMatchObject({ delta: 12, perWeek: 4, drop: mine.find((p) => p.name === "Bench TE")!.playerId });
  });

  it("leaves out a player who'd only sit on the bench", () => {
    expect(pickups.map((p) => p.player.name)).not.toContain("Depth Wideout");
  });

  it("keeps only the top few", () => {
    expect(rankPickups(view, [rb, te, bye], 1)).toHaveLength(1);
  });
});
