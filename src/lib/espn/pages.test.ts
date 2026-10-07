import { describe, expect, it } from "vitest";
import { espnLeaguePage, espnSettingsPage } from "./pages";

describe("ESPN pages", () => {
  it("links a league's standings and its settings by league and season", () => {
    const league = { espnLeagueId: "704343562", season: 2026 };
    expect(espnLeaguePage(league)).toBe("https://fantasy.espn.com/football/league/standings?leagueId=704343562&seasonId=2026");
    expect(espnSettingsPage(league)).toBe("https://fantasy.espn.com/football/league/settings?leagueId=704343562&seasonId=2026");
  });
});
