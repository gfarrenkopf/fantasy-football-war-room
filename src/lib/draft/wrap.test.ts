import { describe, expect, it } from "vitest";
import type { FilledSlot, RosteredPlayer } from "./roster";
import type { Position, RosterSlot } from "./types";
import { draftWrap } from "./wrap";

const slot = (key: RosterSlot["key"], eligible: Position[]): RosterSlot => ({ key, eligible });
const QB = slot("QB", ["QB"]);
const RB = slot("RB", ["RB"]);
const WR = slot("WR", ["WR"]);
const K = slot("K", ["K"]);
const BN = slot("BN", []);

const P = (name: string, pos: Position, pickNo: number, consensusRank: number, bye = 7): RosteredPlayer => ({
  id: name.toLowerCase().replace(/[^a-z]+/g, "-"),
  name,
  pos,
  team: "BUF",
  bye,
  consensusRank,
  adp: consensusRank,
  posRank: 1,
  pickNo,
});

const fill = (pairs: [RosterSlot, RosteredPlayer | null][]): FilledSlot[] => pairs.map(([s, player]) => ({ slot: s, player }));

describe("draftWrap", () => {
  const allen = P("Josh Allen", "QB", 30, 24, 7);
  const gibbs = P("Jahmyr Gibbs", "RB", 3, 1, 8);
  const nacua = P("Puka Nacua", "WR", 22, 9, 7);
  const kicker = P("Brandon Aubrey", "K", 150, 180);
  const benchRb = P("Tony Pollard", "RB", 70, 75);
  const slots = fill([
    [QB, allen],
    [RB, gibbs],
    [WR, nacua],
    [K, kicker],
    [BN, benchRb],
    [BN, null],
  ]);
  const wrap = draftWrap(slots, 12, [5, 6, 7, 8]);

  it("lists filled starters in lineup order with slot and round.pick", () => {
    expect(wrap.starters.map((p) => [p.slot, p.player.name, p.roundPick])).toEqual([
      ["QB", "Josh Allen", "3.06"],
      ["RB", "Jahmyr Gibbs", "1.03"],
      ["WR", "Puka Nacua", "2.10"],
      ["K", "Brandon Aubrey", "13.06"],
    ]);
    expect(wrap.bench.map((p) => p.player.name)).toEqual(["Tony Pollard"]);
  });

  it("measures gain as picks after the consensus rank, and never judges K or D/ST", () => {
    expect(wrap.starters.map((p) => p.gain)).toEqual([6, 2, 13, null]);
    expect(wrap.bench[0].gain).toBe(-5);
  });

  it("names the biggest faller as the steal and counts who beat consensus", () => {
    expect(wrap.steal?.player.name).toBe("Puka Nacua");
    expect(wrap.beat).toEqual({ k: 3, n: 4 });
  });

  it("has no steal when nobody fell, but still names the best player", () => {
    const early = draftWrap(fill([[QB, P("Early", "QB", 5, 20)], [K, kicker]]), 12, [7]);
    expect(early.steal).toBeNull();
    expect(early.best?.player.name).toBe("Early");
    expect(early.beat).toEqual({ k: 0, n: 1 });
  });

  it("reports stacked bye weeks among bye-relevant starters only", () => {
    expect(wrap.stacked).toEqual([{ week: 7, n: 2 }]);
    expect(draftWrap(fill([[QB, allen], [RB, gibbs]]), 12, [7, 8]).stacked).toEqual([]);
  });
});
