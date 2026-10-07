import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { biggestSurprises, trackRecord, type SeasonCalls } from "@/lib/season/accuracy";
import type { GameState } from "@/lib/season/scoreboard";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { projectionAccuracy, recordProjections } from "./seasonProjections";
import { createTestLeague } from "./testLeagues";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const game = (state: GameState["state"]): GameState => ({ state, detail: "", opponent: "NYJ", home: true, kickoff: null, period: 0, clockSeconds: 0, score: null });

/** The user's QB and a bench WR against the other team's QB, in one game state each. */
function week(states: { qb: GameState["state"]; wr: GameState["state"]; theirs: GameState["state"] }, numbers: { qb: number; actual?: number; me: number; them: number; points?: [number, number] }): SeasonView {
  const started = (s: GameState["state"]) => (s === "pre" ? null : (numbers.actual ?? 0));
  const qb = at("QB", player("QB", "QB", numbers.qb, { playerId: 1, game: game(states.qb), actual: started(states.qb) }));
  const wr = at("BN", player("WR", "WR", 10, { playerId: 2, game: game(states.wr), actual: started(states.wr) }));
  const theirs = at("QB", player("Their QB", "QB", 18, { playerId: 3, game: game(states.theirs), actual: started(states.theirs) }));
  const view = seasonView([qb, wr] as ViewPlayer[], [theirs]);
  const [mine, other] = numbers.points ?? [0, 0];
  return { ...view, matchup: { me: { teamId: 1, points: mine, projected: numbers.me, winProbability: 0.6 }, them: { teamId: 2, points: other, projected: numbers.them, winProbability: 0.4 } } };
}

async function league() {
  const userId = await createTestUser(db);
  return createTestLeague(db, userId, "Projections");
}

describe("recording ESPN's projections", () => {
  it("follows the projection until kickoff, then keeps the pre-game one", async () => {
    const leagueId = await league();
    await recordProjections(db, leagueId, week({ qb: "pre", wr: "pre", theirs: "pre" }, { qb: 19, me: 120, them: 110 }));
    await recordProjections(db, leagueId, week({ qb: "pre", wr: "pre", theirs: "pre" }, { qb: 17.5, me: 118, them: 111 }));
    await recordProjections(db, leagueId, week({ qb: "in", wr: "pre", theirs: "in" }, { qb: 25, actual: 9, me: 131, them: 96 }));
    const calls = await projectionAccuracy(db, leagueId, week({ qb: "in", wr: "pre", theirs: "in" }, { qb: 25, me: 131, them: 96 }));
    expect(calls.players.find((p) => p.playerId === 1)).toEqual({ playerId: 1, projected: 17.5, actual: null });
  });

  it("settles a player when his game is final and the matchup when every starter's is", async () => {
    const leagueId = await league();
    await recordProjections(db, leagueId, week({ qb: "pre", wr: "pre", theirs: "pre" }, { qb: 19, me: 120, them: 110 }));
    await recordProjections(db, leagueId, week({ qb: "post", wr: "post", theirs: "in" }, { qb: 19, actual: 26.4, me: 140, them: 100, points: [140, 80] }));
    let calls = await projectionAccuracy(db, leagueId, week({ qb: "post", wr: "post", theirs: "in" }, { qb: 19, me: 140, them: 100 }));
    expect(calls.players.find((p) => p.playerId === 1)).toEqual({ playerId: 1, projected: 19, actual: 26.4 });
    expect(calls.me).toEqual({ projected: 19, actual: null });

    await recordProjections(db, leagueId, week({ qb: "post", wr: "post", theirs: "post" }, { qb: 19, actual: 26.4, me: 141.2, them: 98, points: [141.2, 98] }));
    calls = await projectionAccuracy(db, leagueId, week({ qb: "post", wr: "post", theirs: "post" }, { qb: 19, me: 141.2, them: 98 }));
    expect(calls.me).toEqual({ projected: 19, actual: 141.2 });
    expect(calls.them).toEqual({ projected: 18, actual: 98 });
  });

  it("first seen mid-game, keeps the projection then rather than none", async () => {
    const leagueId = await league();
    await recordProjections(db, leagueId, week({ qb: "in", wr: "pre", theirs: "pre" }, { qb: 21, actual: 4, me: 125, them: 110 }));
    const calls = await projectionAccuracy(db, leagueId, week({ qb: "in", wr: "pre", theirs: "pre" }, { qb: 21, me: 125, them: 110 }));
    expect(calls.players.find((p) => p.playerId === 1)).toEqual({ playerId: 1, projected: 21, actual: null });
    expect(calls.me).toEqual({ projected: 21, actual: null });
    expect(calls.them).toEqual({ projected: 18, actual: null });
  });

  it("calls a team the sum of its starters' projections, not ESPN's matchup projection", async () => {
    const leagueId = await league();
    // First seen after the final whistle, when ESPN's matchup projection has become the score.
    await recordProjections(db, leagueId, week({ qb: "post", wr: "post", theirs: "post" }, { qb: 19, actual: 26.4, me: 26.4, them: 31, points: [26.4, 31] }));
    const calls = await projectionAccuracy(db, leagueId, week({ qb: "post", wr: "post", theirs: "post" }, { qb: 19, me: 26.4, them: 31 }));
    expect(calls.me).toEqual({ projected: 19, actual: 26.4 });
    expect(calls.them).toEqual({ projected: 18, actual: 31 });
  });

  it("averages ESPN's miss on the user's team over earlier settled weeks", async () => {
    const leagueId = await league();
    const done = (w: number, me: number, scored: number) => ({ ...week({ qb: "post", wr: "post", theirs: "post" }, { qb: me, actual: 20, me: scored, them: 90, points: [scored, 90] }), currentWeek: w });
    await recordProjections(db, leagueId, done(3, 120, 130));
    await recordProjections(db, leagueId, done(4, 110, 104));
    const calls = await projectionAccuracy(db, leagueId, { ...week({ qb: "pre", wr: "pre", theirs: "pre" }, { qb: 19, me: 120, them: 110 }), currentWeek: 5 });
    expect(calls.season).toMatchObject({ weeks: 2, meanMiss: 8, meanBias: 2, overcalled: 1 });
    // The QB was called 120 then 110 and scored 20 both weeks.
    expect(calls.season?.players.find((p) => p.playerId === 1)).toEqual({ playerId: 1, weeks: 2, meanMiss: 95, meanBias: -95 });
    expect(calls.me).toBeNull();
  });
});

describe("biggestSurprises", () => {
  it("finds who most beat ESPN and who most fell short, among finished games", () => {
    const { best, worst } = biggestSurprises([
      { playerId: 1, projected: 13.7, actual: 26.7 },
      { playerId: 2, projected: 10.5, actual: 1.4 },
      { playerId: 3, projected: 15, actual: null },
    ]);
    expect(best?.playerId).toBe(1);
    expect(worst?.playerId).toBe(2);
    expect(biggestSurprises([{ playerId: 1, projected: 10, actual: 8 }]).best).toBeNull();
  });
});

describe("trackRecord", () => {
  const season = (players: SeasonCalls["players"]): SeasonCalls => ({ weeks: 4, meanMiss: 10, meanBias: 0, overcalled: 2, players });
  it("names the rostered players ESPN has read most and least closely, over two weeks or more", () => {
    const record = trackRecord(
      season([
        { playerId: 1, weeks: 4, meanMiss: 2.1, meanBias: 0.4 },
        { playerId: 2, weeks: 4, meanMiss: 9.8, meanBias: -6 },
        { playerId: 3, weeks: 1, meanMiss: 0.2, meanBias: 0.2 },
        { playerId: 4, weeks: 3, meanMiss: 14, meanBias: 3 },
      ]),
      new Set([1, 2, 3]),
    );
    expect(record?.surest.playerId).toBe(1);
    expect(record?.shakiest.playerId).toBe(2);
  });
  it("says nothing with fewer than two players to compare", () => {
    expect(trackRecord(season([{ playerId: 1, weeks: 3, meanMiss: 2, meanBias: 0 }]), new Set([1]))).toBeNull();
  });
});
