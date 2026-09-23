/**
 * When Opening Night runs. It premieres a league the first time that league opens on a device
 * before any pick is logged — however the league was made: the landing page, War Room's league
 * setup, or an ESPN import that arrived by sync. Which leagues have premiered is a device pref.
 */

/**
 * The premiered list for a device that has never kept one. Every league already here counts as
 * premiered, so the first load after this shipped doesn't replay the show for old leagues. The one
 * exception is `fresh`: the league the landing page made a moment ago (`?new=1`).
 */
export function seedPremiered(leagueIds: readonly string[], fresh: string | null): string[] {
  return leagueIds.filter((id) => id !== fresh);
}

/**
 * Whether opening this league should run the show. A league with picks has been drafting somewhere
 * already, maybe on another device, so it isn't new to the user even if it's new to this device.
 */
export function shouldPremiere(premiered: readonly string[], leagueId: string, pickCount: number): boolean {
  return pickCount === 0 && !premiered.includes(leagueId);
}
