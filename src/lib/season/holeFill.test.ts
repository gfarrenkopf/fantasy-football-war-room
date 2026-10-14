import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/draft/types";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { fillPlan, fillSteps } from "./holeFill";
import type { Fill, Hole, PoolPlayer } from "./holes";
import type { SeasonView, ViewPlayer } from "./view";

const p = (name: string, pos: Position, pts: number, over: Partial<ViewPlayer> = {}) => player(name, pos, pts, over);
const free = (name: string, pos: Position, pts: number): PoolPlayer => ({ ...p(name, pos, pts), status: "FREEAGENT", waiverClears: null });

const lamar = p("Lamar", "QB", 0, { injuryStatus: "OUT" });
const benchWr = p("Bench WR", "WR", 4);
const view = seasonView([
  at("QB", lamar),
  at("RB", p("RB1", "RB", 15)),
  at("RB", p("RB2", "RB", 12)),
  at("WR", p("WR1", "WR", 14)),
  at("WR", p("WR2", "WR", 11)),
  at("TE", p("TE1", "TE", 8)),
  at("FLEX", p("Flex WR", "WR", 9)),
  p("Bench RB", "RB", 6),
  benchWr,
]);
const hole: Hole = { key: "QB", kind: "hard", reason: "out", playerId: lamar.playerId, kickoff: null };
const flacco = free("Flacco", "QB", 17);
const names = new Map<number, string>([...view.teams[0].roster.map((x) => [x.playerId, x.name] as const), [flacco.playerId, flacco.name]]);
const name = (id: number) => names.get(id)!;
const slotOf = (v: SeasonView, id: number) => v.teams[0].roster.find((x) => x.playerId === id)!.slot;

describe("fillPlan", () => {
  it("moves the hole's player to IR, adds the fill, then starts him in the open seat", () => {
    const fill: Fill = { player: flacco, drop: null, ir: lamar.playerId };
    const plan = fillPlan(view, hole, fill)!;
    expect(plan.ir).toMatchObject({ move: { playerId: lamar.playerId, from: "QB", to: "IR" } });
    expect(plan.ir!.snapshot.find((x) => x.playerId === lamar.playerId)?.slot).toBe("QB");
    // The add is checked against the roster IR left.
    expect(plan.add).toMatchObject({ add: flacco.playerId, drop: null });
    expect(plan.add.snapshot.find((x) => x.playerId === lamar.playerId)?.slot).toBe("IR");
    // Lamar left the seat for IR, so nobody makes way.
    expect(plan.out).toBeNull();
    expect(plan.start.moves).toEqual([{ playerId: flacco.playerId, from: "BN", to: "QB" }]);
    expect(plan.start.snapshot).toContainEqual({ playerId: flacco.playerId, slot: "BN" });
    expect(plan.start.suggested).toEqual([{ playerId: flacco.playerId, to: "QB", gain: 17 }]);
    expect(fillSteps(plan, hole.key, name)).toEqual(["Move Lamar to IR", "Add Flacco", "Start Flacco at QB"]);
  });

  it("adds with a drop and benches the hole's player when IR can't help", () => {
    const fill: Fill = { player: flacco, drop: benchWr.playerId, ir: null };
    const plan = fillPlan({ ...view, irSlots: 0 }, hole, fill)!;
    expect(plan.ir).toBeNull();
    expect(plan.add).toMatchObject({ add: flacco.playerId, drop: benchWr.playerId });
    expect(plan.start.snapshot.some((x) => x.playerId === benchWr.playerId)).toBe(false);
    expect(plan.out).toBe(lamar.playerId);
    expect(plan.start.moves).toEqual([
      { playerId: flacco.playerId, from: "BN", to: "QB" },
      { playerId: lamar.playerId, from: "QB", to: "BN" },
    ]);
    expect(fillSteps(plan, hole.key, name)).toEqual(["Add Flacco and drop Bench WR", "Start Flacco at QB over Lamar"]);
  });

  it("starts the fill in an open seat when the hole's player was the drop", () => {
    const fill: Fill = { player: flacco, drop: lamar.playerId, ir: null };
    const plan = fillPlan(view, hole, fill)!;
    expect(plan.out).toBeNull();
    expect(plan.start.moves).toEqual([{ playerId: flacco.playerId, from: "BN", to: "QB" }]);
  });

  it("benches the starter projecting least when the hole's player isn't in a full slot", () => {
    // A TE hole whose only TE is on a bye, with the slot held by him: he makes way.
    const te = view.teams[0].roster.find((x) => x.name === "TE1")!;
    const plan = fillPlan(view, { key: "TE", playerId: null }, { player: free("Stream TE", "TE", 7), drop: benchWr.playerId, ir: null })!;
    expect(slotOf(view, te.playerId)).toBe("TE");
    expect(plan.out).toBe(te.playerId);
  });

  it("is null when the IR player isn't on the roster any more", () => {
    expect(fillPlan(view, hole, { player: flacco, drop: null, ir: 424242 })).toBeNull();
  });
});
