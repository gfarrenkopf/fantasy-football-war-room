import type { RosterSlotKey } from "@/lib/draft/types";
import { SLOT_BY_ESPN_ID } from "@/lib/espn/league";
import { ESPN_POSITIONS, PRO_TEAMS } from "@/lib/espn/proTeams";
import { parseScoringItems } from "./scoring";
import type { LineupSlot, LineupSlotCount, PendingTrade, RosterEntry, SeasonLeague, SeasonTeam } from "./types";

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

const LINEUP_ORDER: readonly LineupSlotCount["key"][] = ["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "DST", "K"];
const BENCH = 20;
const IR = 21;

/** ESPN's slot id for each of our slots: the inverse of SLOT_BY_ESPN_ID, for lineup writes. */
export const ESPN_SLOT_ID: Readonly<Record<RosterSlotKey | "IR", number>> = {
  ...(Object.fromEntries(Object.entries(SLOT_BY_ESPN_ID).map(([id, key]) => [key, Number(id)])) as Record<RosterSlotKey, number>),
  IR,
};

function parseEntry(raw: unknown): RosterEntry | null {
  if (!isObject(raw) || typeof raw.playerId !== "number" || typeof raw.lineupSlotId !== "number") return null;
  const pool = isObject(raw.playerPoolEntry) ? raw.playerPoolEntry : {};
  const player = isObject(pool.player) ? pool.player : {};
  const pos = typeof player.defaultPositionId === "number" ? ESPN_POSITIONS[player.defaultPositionId] : undefined;
  const slot: LineupSlot | undefined = raw.lineupSlotId === IR ? "IR" : SLOT_BY_ESPN_ID[raw.lineupSlotId];
  if (!pos || !slot) return null;
  const injury = typeof player.injuryStatus === "string" ? player.injuryStatus : typeof raw.injuryStatus === "string" ? raw.injuryStatus : "ACTIVE";
  return {
    playerId: raw.playerId,
    name: typeof player.fullName === "string" ? player.fullName : `ESPN player ${raw.playerId}`,
    pos,
    team: typeof player.proTeamId === "number" ? (PRO_TEAMS[player.proTeamId] ?? null) : null,
    slot,
    espnSlotId: raw.lineupSlotId,
    locked: pool.lineupLocked === true,
    injuryStatus: injury,
  };
}

const TRADE_STATUS: Readonly<Record<string, PendingTrade["status"]>> = { TRADE_PROPOSAL: "proposed", TRADE_ACCEPT: "accepted" };

const isoOf = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

/**
 * `mPendingTransactions` as pending trades (10.9): proposals waiting on a team, and accepted trades
 * in their review period. Anything else pending (waiver claims) is left out, and so is a trade that
 * isn't between exactly two teams.
 */
export function parsePendingTrades(raw: unknown): PendingTrade[] {
  const list = isObject(raw) && Array.isArray(raw.pendingTransactions) ? raw.pendingTransactions : [];
  return list.flatMap((tx): PendingTrade[] => {
    if (!isObject(tx) || tx.status !== "PENDING" || typeof tx.type !== "string" || typeof tx.id !== "string" || typeof tx.teamId !== "number") return [];
    const status = TRADE_STATUS[tx.type];
    if (!status || !Array.isArray(tx.items)) return [];
    const moves = tx.items.flatMap((i) =>
      isObject(i) && i.type === "TRADE" && typeof i.playerId === "number" && typeof i.fromTeamId === "number" && typeof i.toTeamId === "number"
        ? [{ playerId: i.playerId, fromTeamId: i.fromTeamId, toTeamId: i.toTeamId }]
        : [],
    );
    const teams = new Set(moves.flatMap((m) => [m.fromTeamId, m.toTeamId]));
    if (!moves.length || teams.size !== 2 || !teams.has(tx.teamId)) return [];
    const partnerTeamId = [...teams].find((t) => t !== tx.teamId)!;
    return [
      {
        id: tx.id,
        status,
        proposerTeamId: tx.teamId,
        partnerTeamId,
        moves,
        proposedAt: isoOf(tx.proposedDate),
        expiresAt: isoOf(tx.expirationDate),
        processesAt: isoOf(tx.processDate),
      },
    ];
  });
}

/**
 * ESPN's league document as a SeasonLeague, or why it can't be one. Players at positions War Room
 * doesn't play (IDP, say) are left off rosters; a lineup slot War Room can't represent is an error,
 * like it is when the league is connected (toSeasonSettings()).
 */
export function parseSeasonLeague(raw: unknown, espnLeagueId: string): { ok: true; league: SeasonLeague } | { ok: false; error: string } {
  if (!isObject(raw) || !isObject(raw.settings)) return { ok: false, error: "ESPN didn't send this league's settings." };
  const settings = raw.settings;
  const status = isObject(raw.status) ? raw.status : {};
  const season = typeof raw.seasonId === "number" ? raw.seasonId : 0;
  const currentWeek = typeof raw.scoringPeriodId === "number" ? raw.scoringPeriodId : 0;
  const finalWeek = typeof status.finalScoringPeriod === "number" ? status.finalScoringPeriod : 0;
  if (!season || !currentWeek || !finalWeek) return { ok: false, error: "ESPN didn't say which week it is." };

  const counts = isObject(settings.rosterSettings) && isObject(settings.rosterSettings.lineupSlotCounts) ? settings.rosterSettings.lineupSlotCounts : null;
  if (!counts) return { ok: false, error: "ESPN didn't say what this league's roster looks like." };
  const starting = new Map<LineupSlotCount["key"], number>();
  let benchSize = 0;
  for (const [id, n] of Object.entries(counts)) {
    if (typeof n !== "number" || n <= 0 || Number(id) === IR) continue;
    if (Number(id) === BENCH) {
      benchSize += n;
      continue;
    }
    const key = SLOT_BY_ESPN_ID[Number(id)];
    if (!key || key === "BN") return { ok: false, error: `This league starts a lineup slot War Room doesn't support yet (ESPN slot ${id}).` };
    starting.set(key, (starting.get(key) ?? 0) + n);
  }
  const starters = LINEUP_ORDER.filter((k) => starting.has(k)).map((key) => ({ key, count: starting.get(key)! }));

  const teams: SeasonTeam[] = (Array.isArray(raw.teams) ? raw.teams : []).flatMap((t): SeasonTeam[] => {
    if (!isObject(t) || typeof t.id !== "number") return [];
    const entries = isObject(t.roster) && Array.isArray(t.roster.entries) ? t.roster.entries : [];
    const name = typeof t.name === "string" && t.name ? t.name : [t.location, t.nickname].filter((x) => typeof x === "string").join(" ") || `Team ${t.id}`;
    return [{ id: t.id, name, abbrev: typeof t.abbrev === "string" ? t.abbrev : "", roster: entries.flatMap((e) => parseEntry(e) ?? []) }];
  });

  return {
    ok: true,
    league: {
      espnLeagueId,
      season,
      name: typeof settings.name === "string" ? settings.name : `ESPN league ${espnLeagueId}`,
      currentWeek,
      finalWeek,
      scoringItems: parseScoringItems(isObject(settings.scoringSettings) ? settings.scoringSettings.scoringItems : undefined),
      starters,
      benchSize,
      teams,
      pendingTrades: parsePendingTrades(raw),
    },
  };
}
