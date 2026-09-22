import { describe, expect, it } from "vitest";
import { standardRoster } from "@/lib/data";
import type { LivePick } from "./live";
import { offBoardPlayer, slotMismatch, syncMode, toDraftPicks } from "./sync";

const pick = (n: number, over: Partial<LivePick> = {}): LivePick => ({
  n,
  teamId: 1,
  mine: false,
  auto: false,
  espnPlayerId: 100 + n,
  playerId: `p${n}`,
  offBoard: null,
  ...over,
});

describe("toDraftPicks", () => {
  it("uses the war room player, or an espn: id with a label for off-board picks", () => {
    expect(
      toDraftPicks([pick(1, { mine: true }), pick(2, { playerId: null, offBoard: { name: "Deep Sleeper", pos: "WR", team: "SEA" } }), pick(3, { playerId: null })]),
    ).toEqual([
      { playerId: "p1", mine: true },
      { playerId: "espn:102", mine: false, label: { name: "Deep Sleeper", pos: "WR", team: "SEA" } },
      { playerId: "espn:103", mine: false, label: { name: "ESPN player 103", pos: null, team: null } },
    ]);
  });
});

describe("syncMode", () => {
  const mode = (s: Partial<Parameters<typeof syncMode>[0]>) => syncMode({ status: "live", anchored: false, picks: [], degraded: null, ...s });

  it("replaces for a feed that saw the whole draft, merges for one that joined late, and waits for a bridge", () => {
    expect(mode({ anchored: true })).toBe("replace");
    expect(mode({ status: "bridge-offline", anchored: true, picks: [pick(1)] })).toBe("replace");
    expect(mode({ picks: [pick(1)] })).toBe("merge");
    expect(mode({})).toBeNull();
    expect(mode({ status: "waiting" })).toBeNull();
  });

  it("stops applying picks once the feed can't be trusted (8.6)", () => {
    const degraded = { reason: "ESPN's draft feed changed", unknownFrames: 30, malformedFrames: 0 };
    expect(mode({ anchored: true, picks: [pick(1)], degraded })).toBeNull();
  });
});

describe("slotMismatch", () => {
  const league = { teams: 4, mySlot: 2, roster: standardRoster() };

  it("finds the user's ESPN pick that the league's settings give to someone else", () => {
    expect(slotMismatch([pick(1), pick(2, { mine: true }), pick(7, { mine: true })], league)).toBeNull();
    expect(slotMismatch([pick(1, { mine: true })], league)).toMatchObject({ n: 1 });
  });
});

describe("offBoardPlayer", () => {
  const byes = { JAC: 8, WAS: 12, DET: 6 };

  it("stands in for an off-board pick, with its team's bye even when sources spell the team differently", () => {
    const p = offBoardPlayer({ playerId: "espn:1", mine: true, label: { name: "Deep Sleeper", pos: "WR", team: "JAX" } }, byes, 0);
    expect(p).toMatchObject({ id: "espn:1", name: "Deep Sleeper", pos: "WR", team: "JAX", bye: 8 });
    expect(offBoardPlayer({ playerId: "espn:2", mine: true, label: { name: "X", pos: "TE", team: "WSH" } }, byes, 0)?.bye).toBe(12);
  });

  it("gives a free agent a bye nobody else can have", () => {
    const a = offBoardPlayer({ playerId: "espn:1", mine: true, label: { name: "A", pos: "RB", team: null } }, byes, 0);
    const b = offBoardPlayer({ playerId: "espn:2", mine: true, label: { name: "B", pos: "RB", team: null } }, byes, 1);
    expect(a?.bye).toBeLessThan(0);
    expect(a?.bye).not.toBe(b?.bye);
    expect(a?.team).toBe("FA");
  });

  it("can't stand in without a position", () => {
    expect(offBoardPlayer({ playerId: "espn:1", mine: true, label: { name: "A", pos: null, team: null } }, byes, 0)).toBeNull();
    expect(offBoardPlayer({ playerId: "p1", mine: true }, byes, 0)).toBeNull();
  });
});
