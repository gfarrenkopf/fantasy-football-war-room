import { describe, expect, it } from "vitest";
import { parseScoreboard } from "./scoreboard";

const event = (state: string, shortDetail: string, teamIds: (number | string)[], { period = 0, clock = 0, scores = [] as string[] } = {}) => ({
  date: "2026-10-04T17:00Z",
  status: { period, clock, type: { state, shortDetail } },
  competitions: [{ competitors: teamIds.map((id, i) => ({ homeAway: i === 0 ? "home" : "away", team: { id: String(id) }, score: scores[i] ?? "0" })) }],
});

describe("parseScoreboard", () => {
  it("gives both teams in a game its state and ESPN's status line", () => {
    const games = parseScoreboard({
      events: [event("pre", "10/4 - 1:00 PM EDT", [2, 17]), event("in", "4:12 - 3rd", [9, 1]), event("post", "Final/OT", [8, 20])],
    });
    expect(games.get("BUF")).toEqual({
      state: "pre",
      detail: "10/4 - 1:00 PM EDT",
      opponent: "NE",
      home: true,
      kickoff: "2026-10-04T17:00:00.000Z",
      period: 0,
      clockSeconds: 0,
      score: null,
    });
    expect(games.get("GB")).toMatchObject({ state: "in", detail: "4:12 - 3rd", opponent: "ATL", home: true });
    expect(games.get("ATL")).toMatchObject({ state: "in", opponent: "GB", home: false });
    expect(games.get("DET")).toMatchObject({ state: "post", detail: "Final/OT" });
  });

  it("reads the quarter, the clock and the score from each team's side once the game starts", () => {
    const games = parseScoreboard({ events: [event("in", "8:38 - 1st", [21, 14], { period: 1, clock: 518, scores: ["7", "3"] })] });
    expect(games.get("PHI")).toMatchObject({ period: 1, clockSeconds: 518, score: { team: 7, opponent: 3 } });
    expect(games.get("LAR")).toMatchObject({ score: { team: 3, opponent: 7 } });
  });

  it("leaves out malformed events, unknown states and teams War Room doesn't know", () => {
    const games = parseScoreboard({ events: [null, { status: {} }, event("delayed", "Delayed", [9]), event("in", "Halftime", [999, 12])] });
    expect([...games.keys()]).toEqual(["KC"]);
    expect(parseScoreboard(null).size).toBe(0);
  });
});
