import { describe, expect, it } from "vitest";
import league from "./__fixtures__/espn-league-2026.json";
import projections from "./__fixtures__/espn-projections-2026.json";
import { parseSeasonLeague } from "./espnLeague";
import { parseProjections } from "./projections";
import { buildSeasonView } from "./view";

const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const season = parsed.league;
const byId = new Map(parseProjections(projections, 2026).map((p) => [p.id, p]));

describe("buildSeasonView", () => {
  const view = buildSeasonView(season, 1, byId);

  it("scores every rostered player week by week, through the league's last week", () => {
    const gibbs = view.teams[0].roster.find((p) => p.name === "Jahmyr Gibbs")!;
    expect(Object.keys(gibbs.weekly).map(Number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(gibbs.weekly[6]).toBe(0);
    expect(gibbs.points).toBe(gibbs.weekly[3]);
    expect(gibbs.ros).toBeCloseTo(Object.values(gibbs.weekly).reduce((a, b) => a + b, 0), 1);
    expect(gibbs.projected).toBe(true);
  });

  it("shows a player ESPN didn't project as 0, and says so", () => {
    const other = view.teams[1].roster[0];
    expect(other).toMatchObject({ projected: false, points: 0, ros: 0 });
  });

  it("puts each player's NFL game on him by team, and nothing on a team without one", () => {
    const games = new Map([["DET", { state: "in" as const, detail: "4:12 - 3rd", opponent: "NYJ", home: false, kickoff: null }]]);
    const live = buildSeasonView(season, 1, byId, { games });
    const gibbs = live.teams[0].roster.find((p) => p.name === "Jahmyr Gibbs")!;
    expect(gibbs.game).toMatchObject({ state: "in", detail: "4:12 - 3rd", opponent: "NYJ" });
    expect(live.teams[0].roster.filter((p) => p.team !== "DET").every((p) => p.game === null)).toBe(true);
    expect(view.teams[0].roster.every((p) => p.game === null)).toBe(true);
  });

  it("keeps ESPN's outlook only for the user's players with news in the last day", () => {
    const at = Date.parse("2026-09-29T12:00:00Z");
    const news = (hoursAgo: number) => ({ note: "Note.", at: new Date(at - hoursAgo * 3600_000).toISOString() });
    const withNews = {
      ...season,
      teams: season.teams.map((t, i) => ({ ...t, roster: t.roster.map((e, j) => ({ ...e, news: news(i === 0 && j === 0 ? 23 : i === 0 && j === 1 ? 25 : 1) })) })),
    };
    const v = buildSeasonView(withNews, 1, byId, { now: at });
    expect(v.teams[0].roster.map((p) => p.news !== null).slice(0, 3)).toEqual([true, false, true]);
    expect(v.teams[1].roster.every((p) => p.news === null)).toBe(true);
  });

  it("says whether the trade deadline had passed when ESPN was read", () => {
    const withDeadline = { ...season, tradeDeadline: "2026-11-19T17:00:00.000Z" };
    expect(buildSeasonView(withDeadline, 1, byId, { now: Date.parse("2026-11-19T16:59:00Z") }).tradeDeadlinePassed).toBe(false);
    expect(buildSeasonView(withDeadline, 1, byId, { now: Date.parse("2026-11-19T17:01:00Z") }).tradeDeadlinePassed).toBe(true);
    expect(buildSeasonView(season, 1, byId, { now: Date.parse("2027-01-01") }).tradeDeadlinePassed).toBe(false);
  });

  it("finds the user's matchup from either side, and none on a bye", () => {
    const side = (teamId: number) => ({ teamId, points: 0, projected: 100 + teamId, winProbability: 0.5 });
    const withMatchups = { ...season, matchups: [{ home: side(2), away: side(1) }, { home: side(3), away: null }] };
    expect(buildSeasonView(withMatchups, 1, byId).matchup).toEqual({ me: side(1), them: side(2) });
    expect(buildSeasonView(withMatchups, 3, byId).matchup).toBeNull();
  });

  it("recommends the user's own lineup", () => {
    expect(view.lineup.starters.every((s) => s.playerId !== null)).toBe(true);
    const mine = new Set(view.teams[0].roster.map((p) => p.playerId));
    expect(view.lineup.starters.every((s) => mine.has(s.playerId!))).toBe(true);
  });
});
