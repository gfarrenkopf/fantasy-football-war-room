import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/draft/types";
import { pickDrops, type DropLeague } from "./drops";
import type { ViewPlayer } from "./view";

/** Weeks 3–5: three weeks left. */
const LEAGUE: DropLeague = {
  starters: [
    { key: "QB", count: 1 },
    { key: "RB", count: 2 },
    { key: "WR", count: 2 },
    { key: "TE", count: 1 },
    { key: "FLEX", count: 1 },
    { key: "K", count: 1 },
  ],
  currentWeek: 3,
  finalWeek: 5,
};

let nextId = 0;
/** A player projecting `pts` every week, or per week when given an array for weeks 3–5. */
function p(pos: Position, pts: number | number[], extra: Partial<ViewPlayer> = {}): ViewPlayer {
  const byWeek = Array.isArray(pts) ? pts : [pts, pts, pts];
  return {
    playerId: ++nextId,
    name: `${pos}${nextId}`,
    pos,
    team: "DET",
    slot: "BN",
    espnSlotId: 20,
    locked: false,
    injuryStatus: "ACTIVE",
    weekly: { 3: byWeek[0], 4: byWeek[1], 5: byWeek[2] },
    points: byWeek[0],
    ros: byWeek.reduce((a, b) => a + b, 0),
    projected: true,
    actual: null,
    statLine: null,
    ownership: null,
    news: null,
    game: null,
    ...extra,
  };
}

const core = () => [p("QB", 20), p("RB", 15), p("RB", 14), p("WR", 13), p("WR", 12), p("WR", 10)];

describe("pickDrops", () => {
  it("never cuts a position below its own slots, however little he projects", () => {
    const te = p("TE", 1);
    const k = p("K", 0.5);
    const benchRb = p("RB", 3);
    expect(pickDrops([...core(), te, k, benchRb], 1, LEAGUE)).toEqual([benchRb.playerId]);
  });

  it("cuts from the deeper position first, unless the shallower player is worth far less", () => {
    const backupQb = p("QB", 3);
    const rbs = [p("RB", 3.5), p("RB", 3.6)];
    const roster = [...core(), p("TE", 8), p("K", 7), backupQb, ...rbs];
    // RB runs two deep past its slots, so a 3.5-a-week RB goes before a backup QB worth 3.
    expect(pickDrops(roster, 1, LEAGUE)).toEqual([rbs[0].playerId]);
    const cheapQb = p("QB", 1);
    expect(pickDrops([...core(), p("TE", 8), p("K", 7), cheapQb, ...rbs], 1, LEAGUE)).toEqual([cheapQb.playerId]);
  });

  it("keeps the backup who covers next week's bye", () => {
    const byeTe = p("TE", [9, 0, 9]);
    const backupTe = p("TE", 2);
    const benchWr = p("WR", 3);
    expect(pickDrops([...core(), byeTe, backupTe, p("K", 7), benchWr], 1, LEAGUE)).toEqual([benchWr.playerId]);
  });

  it("never cuts who the caller keeps, or who isn't droppable", () => {
    const incoming = p("RB", 1);
    const locked = p("WR", 2, { locked: true });
    const benchRb = p("RB", 5);
    const roster = [...core(), p("TE", 8), p("K", 7), incoming, locked, benchRb];
    expect(pickDrops(roster, 1, LEAGUE, { keep: new Set([incoming.playerId]), droppable: (x) => !x.locked })).toEqual([benchRb.playerId]);
  });

  it("cuts several, re-counting each position as it goes", () => {
    const tes = [p("TE", 8), p("TE", 2), p("TE", 1)];
    expect(pickDrops([...core(), ...tes, p("K", 7)], 2, LEAGUE).sort()).toEqual([tes[1].playerId, tes[2].playerId].sort());
  });

  it("still makes room when every rule would refuse", () => {
    const qb = p("QB", 20);
    expect(pickDrops([qb], 1, LEAGUE)).toEqual([qb.playerId]);
  });

  it("never cuts a player on IR", () => {
    const ir = p("RB", 0, { slot: "IR" });
    expect(pickDrops([...core(), p("TE", 8), p("K", 7), ir], 1, LEAGUE)).not.toContain(ir.playerId);
  });
});
