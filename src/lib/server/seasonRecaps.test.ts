import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { GameState } from "@/lib/season/scoreboard";
import type { SeasonView } from "@/lib/season/view";
import { recordProjections } from "./seasonProjections";
import { keepWeeks, listWeeks, saveWeek } from "./seasonRecaps";
import { createTestLeague } from "./testLeagues";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const game = (state: GameState["state"]): GameState => ({
  state,
  detail: "",
  opponent: "NYJ",
  home: true,
  kickoff: null,
  period: 0,
  clockSeconds: 0,
  score: null,
});

/** Week `week`: the user's QB scoring `scored` against the other team's QB, every game in `state`. */
function week(w: number, scored: number, state: GameState["state"] = "post"): SeasonView {
  const qb = at("QB", player("QB", "QB", 19, { playerId: 1, game: game(state), actual: scored }));
  const theirs = at("QB", player("Their QB", "QB", 18, { playerId: 3, game: game(state), actual: 12 }));
  const view = seasonView([qb], [theirs]);
  const sides = {
    home: { teamId: 1, points: scored, projected: scored, winProbability: null },
    away: { teamId: 2, points: 12, projected: 12, winProbability: null },
  };
  return { ...view, currentWeek: w, matchups: [sides], matchup: { me: sides.home, them: sides.away } };
}

async function league() {
  return createTestLeague(db, await createTestUser(db), "Recaps");
}

describe("the recap archive", () => {
  it("keeps a week's facts, with ESPN's pre-kickoff call for the user's players", async () => {
    const leagueId = await league();
    await recordProjections(db, leagueId, week(3, 0, "pre"));
    await saveWeek(db, leagueId, { ...week(3, 25), teams: week(3, 25).teams.map((t) => ({ ...t, roster: t.roster.map((p) => ({ ...p, points: 30 })) })) });
    const [facts] = await listWeeks(db, leagueId);
    expect(facts).toMatchObject({ week: 3, season: 2026, myTeamId: 1 });
    expect(facts.teams[0].players[0]).toMatchObject({ playerId: 1, points: 25, projected: 19 });
    expect(facts.teams[1].players[0]).toMatchObject({ playerId: 3, projected: 30 });
  });

  it("lets only a settling save rewrite a settled week", async () => {
    const leagueId = await league();
    await saveWeek(db, leagueId, week(4, 20), { settle: true });
    await saveWeek(db, leagueId, week(4, 99));
    expect((await listWeeks(db, leagueId))[0].matchups[0].home.points).toBe(20);
    await saveWeek(db, leagueId, week(4, 21.5), { settle: true });
    expect((await listWeeks(db, leagueId))[0].matchups[0].home.points).toBe(21.5);
  });

  it("fills in missing finished weeks, newest first, up to the limit", async () => {
    const leagueId = await league();
    await saveWeek(db, leagueId, week(4, 20));
    const asked: number[] = [];
    const loadWeek = async (w: number) => {
      asked.push(w);
      if (w === 2) throw new Error("ESPN said no");
      return week(w, 10 + w);
    };
    expect(await keepWeeks(db, leagueId, { season: 2026, throughWeek: 4, loadWeek, limit: 2 })).toEqual({ saved: 1, failed: 1 });
    expect(asked).toEqual([3, 2]);
    expect((await listWeeks(db, leagueId)).map((f) => f.week)).toEqual([3, 4]);
  });

  it("settling reads the weeks not yet settled, and skips a week still being played", async () => {
    const leagueId = await league();
    await saveWeek(db, leagueId, week(1, 20), { settle: true });
    await saveWeek(db, leagueId, week(2, 20));
    const asked: number[] = [];
    const loadWeek = async (w: number) => {
      asked.push(w);
      return week(w, 30, w === 3 ? "in" : "post");
    };
    expect(await keepWeeks(db, leagueId, { season: 2026, throughWeek: 3, loadWeek, settle: true })).toEqual({ saved: 1, failed: 0 });
    expect(asked).toEqual([3, 2]);
    expect((await listWeeks(db, leagueId)).map((f) => [f.week, f.matchups[0].home.points])).toEqual([
      [1, 20],
      [2, 30],
    ]);
  });
});
