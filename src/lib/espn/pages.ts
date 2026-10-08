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

/**
 * A league's settings on ESPN (Epic 15). A league that follows ESPN takes its settings from there, so
 * Draft Room's League settings opens this instead of its own dialog. ESPN's app claims this path,
 * which suits it: on a phone, settings open where they can be changed.
 */
export function espnSettingsPage({ espnLeagueId, season }: { espnLeagueId: string; season: number }): string {
  const q = new URLSearchParams({ leagueId: espnLeagueId, seasonId: String(season) });
  return `https://fantasy.espn.com/football/league/settings?${q}`;
}

/**
 * Draft Room's own bookmark setup page (APE-333), opened for what the user came to do: connect the
 * season, or sync a draft (`league` being the Draft Room league whose ESPN draft it is).
 */
export function espnSetup(intent: "season" | "draft", league?: string | null): string {
  const q = new URLSearchParams({ for: intent, ...(league ? { league } : {}) });
  return `/espn?${q}`;
}

/** A league's ESPN draft, where the bookmark syncs it. ESPN opens it an hour before the draft. */
export function espnDraftPage({ espnLeagueId, espnTeamId, season }: { espnLeagueId: string; espnTeamId: number; season: number }): string {
  const q = new URLSearchParams({ leagueId: espnLeagueId, teamId: String(espnTeamId), seasonId: String(season) });
  return `https://fantasy.espn.com/football/draft?${q}`;
}
