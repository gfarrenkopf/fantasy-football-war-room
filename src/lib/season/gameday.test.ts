import { describe, expect, it } from "vitest";
import { gameDayPhase, gameProgress, leftToPlay, matchupDecided, matchupLive, nextReset, pace } from "./gameday";
import type { GameState } from "./scoreboard";
import type { LineupSlot } from "./types";
import type { SeasonView, ViewPlayer } from "./view";

const game = (state: GameState["state"], over: Partial<GameState> = {}): GameState => ({
  state,
  detail: "",
  opponent: "NYJ",
  home: true,
  kickoff: "2026-10-04T17:00:00.000Z",
  period: state === "pre" ? 0 : 4,
  clockSeconds: 0,
  score: null,
  ...over,
});

let nextId = 1;
const player = (slot: LineupSlot, g: GameState | null, over: Partial<ViewPlayer> = {}) =>
  ({ playerId: nextId++, name: "P", pos: "WR", team: "DET", slot, locked: false, actual: null, points: 10, game: g, ...over }) as ViewPlayer;

const view = (mine: ViewPlayer[], theirs: ViewPlayer[] = []) =>
  ({
    myTeamId: 1,
    teams: [
      { id: 1, roster: mine },
      { id: 2, roster: theirs },
    ],
    matchup: { me: { teamId: 1 }, them: { teamId: 2 } },
  }) as unknown as SeasonView;

const SUNDAY_NIGHT = Date.parse("2026-10-05T03:00:00Z");

describe("gameDayPhase", () => {
  it("is live while any of the user's players, bench included, is in a game", () => {
    expect(gameDayPhase(view([player("WR", game("pre")), player("BN", game("in"))]), SUNDAY_NIGHT)).toBe("live");
  });

  it("stays on the lineup before Sunday's games", () => {
    const thursday = game("post", { kickoff: "2026-10-02T00:15:00.000Z" });
    expect(gameDayPhase(view([player("WR", thursday), player("RB", game("pre"))]), Date.parse("2026-10-03T16:00:00Z"))).toBe("lineup");
    expect(gameDayPhase(view([player("WR", game("pre")), player("RB", game("pre"))]), Date.parse("2026-10-04T15:00:00Z"))).toBe("lineup");
    expect(gameDayPhase(view([player("WR", null)]), SUNDAY_NIGHT)).toBe("lineup");
  });

  it("stays on game day from Sunday night until Monday night's kickoff", () => {
    const monday = game("pre", { kickoff: "2026-10-06T00:15:00.000Z" });
    expect(gameDayPhase(view([player("WR", game("post")), player("RB", monday)]), SUNDAY_NIGHT)).toBe("live");
  });

  it("shows the results once every starter is final, with a bench player still to play", () => {
    const monday = game("pre", { kickoff: "2026-10-06T00:15:00.000Z" });
    const done = view([player("WR", game("post")), player("BN", monday)]);
    expect(gameDayPhase(done, SUNDAY_NIGHT)).toBe("results");
    expect(gameDayPhase(done, Date.parse("2026-10-06T10:00:00Z"))).toBe("lineup");
  });

  it("ignores a player on IR", () => {
    expect(gameDayPhase(view([player("WR", game("pre")), player("IR", game("in"))]), SUNDAY_NIGHT)).toBe("lineup");
  });

  it("shows the results once every player is final, until Tuesday 6 AM Eastern", () => {
    const done = view([player("WR", game("post")), player("BN", game("post", { kickoff: "2026-10-06T00:15:00.000Z" }))]);
    expect(gameDayPhase(done, SUNDAY_NIGHT)).toBe("results");
    expect(gameDayPhase(done, Date.parse("2026-10-06T09:59:00Z"))).toBe("results");
    expect(gameDayPhase(done, Date.parse("2026-10-06T10:00:00Z"))).toBe("lineup");
  });
});

describe("nextReset", () => {
  it("finds the next Tuesday 6 AM Eastern, in daylight time and in standard time", () => {
    expect(new Date(nextReset(Date.parse("2026-10-04T17:00:00Z"))).toISOString()).toBe("2026-10-06T10:00:00.000Z");
    expect(new Date(nextReset(Date.parse("2026-11-08T18:00:00Z"))).toISOString()).toBe("2026-11-10T11:00:00.000Z");
  });

  it("counts across the November clock change", () => {
    // Sunday Nov 1 2026 is the change; Monday night's game is in standard time.
    expect(new Date(nextReset(Date.parse("2026-10-30T00:15:00Z"))).toISOString()).toBe("2026-11-03T11:00:00.000Z");
  });

  it("on a Tuesday, is that morning before 6 and the next week after", () => {
    expect(new Date(nextReset(Date.parse("2026-10-06T09:00:00Z"))).toISOString()).toBe("2026-10-06T10:00:00.000Z");
    expect(new Date(nextReset(Date.parse("2026-10-06T10:00:00Z"))).toISOString()).toBe("2026-10-13T10:00:00.000Z");
  });
});

describe("gameProgress", () => {
  it("counts the quarters and the clock", () => {
    expect(gameProgress(game("pre"))).toBe(0);
    expect(gameProgress(game("in", { period: 1, clockSeconds: 900 }))).toBe(0);
    expect(gameProgress(game("in", { period: 2, clockSeconds: 0 }))).toBe(0.5);
    expect(gameProgress(game("in", { period: 4, clockSeconds: 450 }))).toBeCloseTo(0.875);
    expect(gameProgress(game("in", { period: 5, clockSeconds: 300 }))).toBe(1);
    expect(gameProgress(game("post"))).toBe(1);
  });
});

describe("pace", () => {
  const half = game("in", { period: 2, clockSeconds: 0 });

  it("hasn't started before kickoff", () => {
    expect(pace({ actual: null, points: 10, game: game("pre") })).toBe("pre");
    expect(pace({ actual: null, points: 10, game: null })).toBe("pre");
  });

  it("compares points with the share of the projection played so far", () => {
    expect(pace({ actual: 5, points: 10, game: half })).toBe("on");
    expect(pace({ actual: 1, points: 10, game: half })).toBe("behind");
    expect(pace({ actual: 8, points: 16, game: half })).toBe("on");
    expect(pace({ actual: 9, points: 10, game: half })).toBe("ahead");
  });

  it("is boom once a player passes his whole projection", () => {
    expect(pace({ actual: 12, points: 10, game: half })).toBe("boom");
    expect(pace({ actual: 26.7, points: 13.7, game: game("post") })).toBe("boom");
  });

  it("judges a finished game against the whole projection", () => {
    expect(pace({ actual: 1.4, points: 10.5, game: game("post") })).toBe("behind");
    expect(pace({ actual: 9.5, points: 10.5, game: game("post") })).toBe("on");
  });
});

describe("the matchup", () => {
  it("counts each side's starters still to play", () => {
    const v = view([player("QB", game("in")), player("WR", game("pre")), player("RB", game("post")), player("BN", game("pre"))]);
    expect(leftToPlay(v, 1)).toBe(2);
  });

  it("is decided once every starter on both sides is final", () => {
    const mine = [player("QB", game("post")), player("BN", game("in"))];
    expect(matchupDecided(view(mine, [player("QB", game("post"))]))).toBe(true);
    expect(matchupDecided(view(mine, [player("QB", game("pre"))]))).toBe(false);
    expect(matchupDecided(view([player("QB", null)], [player("QB", null)]))).toBe(false);
  });

  it("is live while a game on either side is under way", () => {
    expect(matchupLive(view([player("QB", game("post"))], [player("QB", game("in"))]))).toBe(true);
    expect(matchupLive(view([player("QB", game("post"))], [player("QB", game("post"))]))).toBe(false);
  });
});
