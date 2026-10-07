/**
 * The user's team page in an ESPN league, where the War Room bookmark connects the season (APE-301).
 * seasonId is explicit so the bridge doesn't have to guess it (see public/espn-bridge.js).
 */
export function espnTeamPage({ espnLeagueId, espnTeamId, season }: { espnLeagueId: string; espnTeamId: number; season: number }): string {
  const q = new URLSearchParams({ leagueId: espnLeagueId, teamId: String(espnTeamId), seasonId: String(season) });
  return `https://fantasy.espn.com/football/team?${q}`;
}
