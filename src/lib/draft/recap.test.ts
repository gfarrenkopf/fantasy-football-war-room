import { describe, expect, it } from "vitest";
import { draftRecap } from "./recap";
import type { DraftPick, Player, Position } from "./types";

const P = (id: string, pos: Position, consensusRank: number): Player => ({ id, name: id, pos, team: "BUF", bye: 7, consensusRank, adp: consensusRank, posRank: 1 });

/** A draft from a list of [player, mine] in pick order. */
function run(players: [Player | string, boolean][], teams: number, mySlot = 1, valueThreshold = 10) {
  const byId = new Map(players.flatMap(([p]) => (typeof p === "string" ? [] : [[p.id, p] as const])));
  const picks: DraftPick[] = players.map(([p, mine]) =>
    typeof p === "string" ? { playerId: p, mine, label: { name: p, pos: "WR", team: null } } : { playerId: p.id, mine },
  );
  return draftRecap(picks, (id) => byId.get(id), { teams, mySlot, valueThreshold });
}

describe("draftRecap", () => {
  it("numbers every pick with its round.pick and the slot that made it, snaking back", () => {
    const players = Array.from({ length: 12 }, (_, i): [Player, boolean] => [P(`p${i + 1}`, "RB", i + 1), false]);
    const recap = run(players, 10);
    expect(recap.picks.map((p) => p.roundPick).slice(9, 12)).toEqual(["1.10", "2.01", "2.02"]);
    expect(recap.picks.map((p) => p.slot).slice(9, 12)).toEqual([10, 10, 9]);
  });

  it("credits the user's picks to their slot even when forced off the snake", () => {
    const recap = run(
      [
        [P("a", "RB", 1), false],
        [P("b", "RB", 2), true],
      ],
      14,
      5,
    );
    expect(recap.picks[1]).toMatchObject({ slot: 5, mine: true });
  });

  it("finds the biggest fall and the biggest reach, league-wide and the user's own", () => {
    const recap = run(
      [
        [P("fell", "WR", 1), false], // 1 - 1 = 0
        [P("reach", "QB", 30), true], // 2 - 30 = -28
        [P("mine-fell", "RB", 1), true], // 3 - 1 = +2
        [P("league-fell", "TE", 1), false], // 4 - 1 = +3
      ],
      10,
    );
    expect(recap.league.steal?.player?.id).toBe("league-fell");
    expect(recap.league.reach?.player?.id).toBe("reach");
    expect(recap.mine.steal?.player?.id).toBe("mine-fell");
    expect(recap.mine.reach?.player?.id).toBe("reach");
  });

  it("names no reach under the league's threshold, and no steal when nobody fell", () => {
    const recap = run(
      [
        [P("a", "WR", 5), true], // -4
        [P("b", "WR", 2), false], // 0
      ],
      10,
    );
    expect(recap.league.reach).toBeNull();
    expect(recap.league.steal).toBeNull();
  });

  it("doesn't judge kickers, defenses or off-board picks", () => {
    const recap = run(
      [
        [P("k", "K", 200), true],
        [P("dst", "DST", 150), false],
        ["Deep Sleeper", false],
      ],
      10,
    );
    expect(recap.picks.map((p) => p.gain)).toEqual([null, null, null]);
    expect(recap.picks[2]).toMatchObject({ player: null, label: { name: "Deep Sleeper" } });
    expect(recap.league.reach).toBeNull();
    expect(recap.sharpest).toBeNull();
  });

  it("breaks a tie by the earliest pick", () => {
    const recap = run(
      [
        [P("x", "WR", 1), false],
        [P("first", "WR", 1), false], // +1
        [P("second", "WR", 2), false], // +1
      ],
      10,
    );
    expect(recap.league.steal?.player?.id).toBe("first");
  });

  it("names the slot that beat consensus most often", () => {
    // 2 teams: slots go 1, 2, 2, 1.
    const recap = run(
      [
        [P("a", "RB", 5), true], // slot 1: -4
        [P("b", "RB", 1), false], // slot 2: +1
        [P("c", "RB", 1), false], // slot 2: +2
        [P("d", "RB", 1), true], // slot 1: +3
      ],
      2,
    );
    expect(recap.teams).toEqual([
      { slot: 1, k: 1, n: 2 },
      { slot: 2, k: 2, n: 2 },
    ]);
    expect(recap.sharpest?.slot).toBe(2);
  });
});
