import type { EspnLogin } from "./logins";

/**
 * The user's ESPN fantasy football leagues, from ESPN's fan API (APE-368): the same list ESPN's
 * own apps use for "My Teams". Lets the iPhone app offer a picker after the user signs in to ESPN,
 * instead of asking for a league id. Read once with the login the app just captured; nothing is
 * stored. Unofficial, like every ESPN endpoint here (docs/espn-protocol.md).
 *
 * Each league is a preference with `typeId` 9 whose `metaData.entry` is a fantasy entry: `abbrev`
 * "FFL" (fantasy football; other games have other abbreviations), `seasonId`, `entryId` (the
 * user's team id), `entryMetadata.teamName`, and `groups[0]` the league (`groupId`, `groupName`).
 */

export interface FanLeague {
  espnLeagueId: string;
  name: string;
  season: number;
  espnTeamId: number;
  teamName: string | null;
}

export type FanLeaguesResult = { ok: true; leagues: FanLeague[] } | { ok: false; reason: "auth" | "unreachable" };

const FAN_API = "https://fan.api.espn.com/apis/v2/fans";
const FANTASY_PREFERENCE = 9;

export async function listFanLeagues(login: EspnLogin, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<FanLeaguesResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${FAN_API}/${encodeURIComponent(login.swid)}?displayHiddenPrefs=true&source=espncom-fantasy-lm`, {
      headers: { Cookie: `espn_s2=${login.espnS2}; SWID=${login.swid}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, reason: "auth" };
  if (!res.ok) return { ok: false, reason: "unreachable" };
  const body = (await res.json().catch(() => null)) as { preferences?: unknown } | null;
  if (!body || !Array.isArray(body.preferences)) return { ok: false, reason: "unreachable" };
  return { ok: true, leagues: parseFanLeagues(body.preferences) };
}

type Entry = {
  abbrev?: unknown;
  seasonId?: unknown;
  entryId?: unknown;
  entryMetadata?: { teamName?: unknown };
  groups?: { groupId?: unknown; groupName?: unknown }[];
};

/** Fantasy football leagues from the fan API's preferences, newest season first, then by name. */
export function parseFanLeagues(preferences: unknown[]): FanLeague[] {
  const seen = new Set<string>();
  const leagues: FanLeague[] = [];
  for (const pref of preferences as { typeId?: unknown; metaData?: { entry?: Entry } }[]) {
    const entry = pref?.metaData?.entry;
    if (Number(pref?.typeId) !== FANTASY_PREFERENCE || !entry || entry.abbrev !== "FFL") continue;
    const group = entry.groups?.[0];
    const season = Number(entry.seasonId);
    const espnTeamId = Number(entry.entryId);
    const espnLeagueId = group?.groupId == null ? "" : String(group.groupId);
    if (!/^\d+$/.test(espnLeagueId) || !Number.isInteger(season) || !Number.isInteger(espnTeamId)) continue;
    const key = `${season}:${espnLeagueId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leagues.push({
      espnLeagueId,
      name: typeof group?.groupName === "string" && group.groupName.trim() ? group.groupName.trim() : `League ${espnLeagueId}`,
      season,
      espnTeamId,
      teamName: typeof entry.entryMetadata?.teamName === "string" ? entry.entryMetadata.teamName : null,
    });
  }
  return leagues.sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
}
