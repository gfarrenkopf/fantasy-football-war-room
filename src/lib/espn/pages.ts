/**
 * ESPN pages to send a phone user to, where the War Room bookmark runs (APE-301, APE-303). ESPN's
 * iPhone app claims most fantasy.espn.com league pages as universal links (/football/team, /football/league,
 * /football/league/settings and more; see its apple-app-site-association), so a tap on those opens the app,
 * where no bookmark can run. These paths aren't claimed, so they stay in the browser.
 */

/** ESPN Fantasy's football hub on www.espn.com: somewhere to sign in to ESPN without being sent to the app. */
export const ESPN_FANTASY_HOME = "https://www.espn.com/fantasy/football/";

/** A league's standings page: a league page the bookmark recognizes (it has `leagueId`) that the app doesn't claim. */
export function espnLeaguePage({ espnLeagueId, season }: { espnLeagueId: string; season: number }): string {
  const q = new URLSearchParams({ leagueId: espnLeagueId, seasonId: String(season) });
  return `https://fantasy.espn.com/football/league/standings?${q}`;
}
