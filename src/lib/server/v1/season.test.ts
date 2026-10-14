import { describe, expect, it } from "vitest";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import projections from "@/lib/season/__fixtures__/espn-projections-2026.json";
import type { ProjectionAccuracy } from "@/lib/season/accuracy";
import { canPlay } from "@/lib/season/apply";
import { parseSeasonLeague } from "@/lib/season/espnLeague";
import { gameDayBench, headToHead, leftToPlay, pace } from "@/lib/season/gameday";
import { findHoles } from "@/lib/season/holes";
import { parseProjections } from "@/lib/season/projections";
import type { GameState } from "@/lib/season/scoreboard";
import { outTag, startSitSwaps } from "@/lib/season/startSit";
import { buildSeasonView, type SeasonView } from "@/lib/season/view";
import { seasonResponse, type SeasonInput } from "./season";

const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const season = parsed.league;
const byId = new Map(parseProjections(projections, 2026).map((p) => [p.id, p]));

const game = (state: GameState["state"], over: Partial<GameState> = {}): GameState => ({
  state,
  detail: "",
  opponent: "NYJ",
  home: true,
  kickoff: "2026-09-20T17:00:00.000Z",
  period: state === "pre" ? 0 : state === "in" ? 2 : 4,
  clockSeconds: state === "in" ? 300 : 0,
  score: null,
  ...over,
});

/** Every NFL team on the fixture's rosters playing a game in the given state. */
function withGames(state: GameState["state"]): SeasonView {
  const teams = new Set(season.teams.flatMap((t) => t.roster.flatMap((e) => (e.team ? [e.team] : []))));
  return buildSeasonView(season, 1, byId, { games: new Map([...teams].map((t) => [t, game(state)])) });
}

/** The fixture with a matchup against team 2, scored as given. */
function withMatchup(view: SeasonView, me = 80, them = 70): SeasonView {
  const side = (teamId: number, points: number) => ({ teamId, points, projected: 100, winProbability: 0.62 });
  return { ...view, matchup: { me: side(view.myTeamId, me), them: side(2, them) }, matchups: [{ home: side(view.myTeamId, me), away: side(2, them) }, { home: side(3, 50), away: side(4, 60) }] };
}

const input = (view: SeasonView, over: Partial<SeasonInput> = {}): SeasonInput => ({
  league: { id: "lg-1", name: "Test League" },
  view,
  phase: "lineup",
  fetchedAt: new Date("2026-09-20T18:00:00Z"),
  stale: false,
  projectionsMissing: false,
  accuracy: null,
  previousAccuracy: null,
  kept: [],
  consent: { version: 2, lines: ["Line one."], consented: null },
  ...over,
});

describe("seasonResponse", () => {
  it("opens on Lineup between weeks and on Game day while games are on or the result is up", () => {
    const view = withGames("pre");
    expect(seasonResponse(input(view)).defaultTab).toBe("lineup");
    expect(seasonResponse(input(view, { phase: "live" })).defaultTab).toBe("gameday");
    expect(seasonResponse(input(view, { phase: "results" })).defaultTab).toBe("gameday");
    expect(seasonResponse(input(view)).tabs).toEqual(["gameday", "lineup", "trade", "waivers"]);
  });

  it("says whether the user has agreed to the current write consent", () => {
    const view = withGames("pre");
    expect(seasonResponse(input(view)).consent).toEqual({ version: 2, lines: ["Line one."], agreed: false });
    expect(seasonResponse(input(view, { consent: { version: 2, lines: [], consented: 1 } })).consent.agreed).toBe(false);
    expect(seasonResponse(input(view, { consent: { version: 2, lines: [], consented: 2 } })).consent.agreed).toBe(true);
  });

  it("tells the live matchup as the scoreboard does, with each side's starters left to play", () => {
    const view = withMatchup(withGames("in"));
    const res = seasonResponse(input(view, { phase: "live" }));
    expect(res.live).toMatchObject({ week: view.currentWeek, status: "Live", live: true, started: true, decided: false, lead: 10, win: 62 });
    expect(res.live!.me).toMatchObject({ teamId: view.myTeamId, points: 80, projected: 100, left: leftToPlay(view, view.myTeamId) });
    expect(res.live!.them).toMatchObject({ teamId: 2, name: view.teams.find((t) => t.id === 2)!.name, points: 70 });
  });

  it("previews the matchup before kickoff, and has no scoreboard without a matchup", () => {
    expect(seasonResponse(input(withMatchup(withGames("pre")))).live).toMatchObject({ status: "Up next", started: false, live: false });
    expect(seasonResponse(input({ ...withGames("pre"), matchup: null })).live).toBeNull();
  });

  it("derives Game day from the same functions as the page", () => {
    const view = withMatchup(withGames("in"));
    const { gameDay } = seasonResponse(input(view, { phase: "live" }));
    expect(gameDay.headToHead).toEqual(headToHead(view).map((r) => ({ key: r.key, me: r.me?.playerId ?? null, them: r.them?.playerId ?? null })));
    expect(gameDay.starters).toEqual([]);
    const mine = view.teams.find((t) => t.id === view.myTeamId)!.roster;
    for (const p of mine) expect(gameDay.pace[p.playerId]).toEqual({ pace: pace(p), progress: expect.any(Number) });
    const bench = gameDayBench(mine);
    expect(gameDay.bench).toEqual({ playerIds: bench.players.map((p) => p.playerId), points: bench.points });
    expect(gameDay.around).toEqual([expect.objectContaining({ home: expect.objectContaining({ teamId: 3 }), away: expect.objectContaining({ teamId: 4 }) })]);
    expect(gameDay.showArchive).toBe(false);
    expect(gameDay.holes).toEqual(findHoles(view).filter((h) => h.kind === "hard"));
  });

  it("lists the user's starters without a matchup, and leaves the league's other games out while none is on", () => {
    const view = { ...withGames("pre"), matchup: null };
    const { gameDay } = seasonResponse(input(view));
    expect(gameDay.headToHead).toEqual([]);
    expect(gameDay.starters.length).toBe(view.starters.reduce((n, s) => n + s.count, 0));
    expect(gameDay.around).toEqual([]);
    expect(gameDay.showArchive).toBe(true);
    expect(gameDay.result).toBeNull();
  });

  it("tells the result once the matchup is decided, and ESPN's call beside it", () => {
    const view = withMatchup(withGames("post"), 101.5, 99);
    const accuracy: ProjectionAccuracy = { me: { projected: 95, actual: 101.5 }, them: { projected: 98, actual: 99 }, players: [], season: null };
    const { gameDay } = seasonResponse(input(view, { result: view, phase: "results", accuracy }));
    expect(gameDay.result?.recap).toMatchObject({ result: "win", me: 101.5, them: 99 });
    expect(gameDay.espnCall).toMatchObject({ me: accuracy.me, them: accuracy.them, best: null, worst: null, season: null });
    expect(gameDay.trackRecord).toBeNull();
  });

  it("between weeks, shows ESPN's season and last week's final until the archive keeps it", () => {
    const view = withGames("pre");
    const previous = withMatchup(withGames("post"), 90, 95);
    const accuracy: ProjectionAccuracy = {
      me: null,
      them: null,
      players: [],
      season: {
        weeks: 3,
        meanMiss: 12,
        meanBias: -2,
        overcalled: 2,
        players: view.teams[0].roster.slice(0, 2).map((p, i) => ({ playerId: p.playerId, weeks: 3, meanMiss: 2 + i * 5, meanBias: 0 })),
      },
    };
    const res = seasonResponse(input(view, { previous, accuracy }));
    expect(res.gameDay.trackRecord).toMatchObject({ weeks: 3, overcalled: 2, surest: { playerId: view.teams[0].roster[0].playerId } });
    expect(res.gameDay.lastWeek).toMatchObject({ result: "loss", me: 90, them: 95 });
    expect(res.gameDay.espnCall).toBeNull();
    const kept = seasonResponse(input(view, { previous, accuracy, kept: [{ season: previous.season, week: previous.currentWeek } as SeasonInput["kept"][number]] }));
    expect(kept.gameDay.lastWeek).toBeNull();
  });

  it("gives the lineup seat by seat, with the slots each player may move to", () => {
    const view = withGames("pre");
    const { lineup } = seasonResponse(input(view));
    const mine = view.teams.find((t) => t.id === view.myTeamId)!.roster;
    expect(lineup.seats.length).toBe(lineup.onEspn.length);
    expect(lineup.recommended.length).toBe(lineup.seats.length);
    expect(new Set(lineup.recommended.filter((id) => id !== null))).toEqual(new Set(view.lineup.starters.flatMap((f) => (f.playerId === null ? [] : [f.playerId]))));
    for (const p of mine) {
      const slots = lineup.eligible[p.playerId];
      expect(slots).toContain("BN");
      expect(slots.filter((s) => s !== "BN" && s !== "IR").every((s) => canPlay(p.pos, s))).toBe(true);
      expect(lineup.tags[p.playerId] ?? null).toEqual(outTag(p));
    }
    expect(lineup.startSit.swaps).toEqual(startSitSwaps(mine, view.lineup));
    expect(lineup.startSit).toMatchObject({ total: view.lineup.total, currentTotal: view.lineup.currentTotal, gain: view.lineup.total - view.lineup.currentTotal });
    expect(lineup.holes).toEqual(findHoles(view));
  });

  it("offers IR only to a player ESPN marks injured, in a league with an IR slot", () => {
    const base = withGames("pre");
    const hurt = base.teams[0].roster[0];
    const view: SeasonView = { ...base, irSlots: 1, teams: base.teams.map((t, i) => (i === 0 ? { ...t, roster: t.roster.map((p) => (p === hurt ? { ...p, injuryStatus: "OUT" } : p)) } : t)) };
    const { lineup } = seasonResponse(input(view));
    expect(lineup.eligible[hurt.playerId]).toContain("IR");
    expect(lineup.eligible[base.teams[0].roster[1].playerId]).not.toContain("IR");
    expect(seasonResponse(input({ ...view, irSlots: 0 })).lineup.eligible[hurt.playerId]).not.toContain("IR");
  });

  it("is plain JSON", () => {
    const res = seasonResponse(input(withMatchup(withGames("in")), { phase: "live" }));
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});
