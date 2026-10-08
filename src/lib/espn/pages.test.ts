import { describe, expect, it } from "vitest";
import { espnDraftPage, espnLeaguePage, espnSettingsPage, espnSetup } from "./pages";

describe("ESPN pages", () => {
  it("links a league's standings and its settings by league and season", () => {
    const league = { espnLeagueId: "704343562", season: 2026 };
    expect(espnLeaguePage(league)).toBe("https://fantasy.espn.com/football/league/standings?leagueId=704343562&seasonId=2026");
    expect(espnSettingsPage(league)).toBe("https://fantasy.espn.com/football/league/settings?leagueId=704343562&seasonId=2026");
  });

  it("links a league's ESPN draft with the user's team", () => {
    expect(espnDraftPage({ espnLeagueId: "704343562", espnTeamId: 3, season: 2026 })).toBe(
      "https://fantasy.espn.com/football/draft?leagueId=704343562&teamId=3&seasonId=2026",
    );
  });

  it("opens the bookmark setup for what the user came to do", () => {
    expect(espnSetup("season")).toBe("/espn?for=season");
    expect(espnSetup("draft", "lg 1")).toBe("/espn?for=draft&league=lg+1");
  });
});
