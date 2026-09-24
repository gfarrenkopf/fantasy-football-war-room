/**
 * Reading ESPN's league document (`mTeam`, `mRoster`, `mSettings`, `mStatus`) for in-season use.
 * Pure; the server fetches it with the user's login (src/lib/server/espn/leagueReader.ts).
 */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** ESPN member ids are `{GUID}`; compare them without braces or case getting in the way. */
const normalizeSwid = (swid: string) => swid.replace(/[{}]/g, "").toUpperCase();

/** The team this ESPN member owns in the league (`mTeam`), or null if they own none. */
export function ownTeamId(league: unknown, swid: string): number | null {
  const teams = isObject(league) && Array.isArray(league.teams) ? league.teams : [];
  const me = normalizeSwid(swid);
  for (const team of teams) {
    if (!isObject(team) || typeof team.id !== "number" || !Array.isArray(team.owners)) continue;
    if (team.owners.some((o) => typeof o === "string" && normalizeSwid(o) === me)) return team.id;
  }
  return null;
}

/** The league's `settings` object, as `mSettings` returns it. */
export function settingsOf(league: unknown): unknown {
  return isObject(league) ? league.settings : undefined;
}
