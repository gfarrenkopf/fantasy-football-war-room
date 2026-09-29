import type { RosterSlotKey } from "@/lib/draft/types";
import { SLOT_BY_ESPN_ID } from "@/lib/espn/league";
import { ESPN_POSITIONS, PRO_TEAMS } from "@/lib/espn/proTeams";
import { parseScoringItems } from "./scoring";
import type { LineupSlot, LineupSlotCount, Matchup, MatchupSide, PendingTrade, RosterEntry, SeasonLeague, SeasonTeam, Standing } from "./types";

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

/** The player's league-scored actual points for one NFL week: the stat row ESPN keys by game. */
function actualPoints(stats: unknown, season: number, week: number): number | null {
  if (!Array.isArray(stats)) return null;
  const row = stats.find(
    (s) => isObject(s) && s.statSourceId === 0 && s.statSplitTypeId === 1 && s.seasonId === season && s.scoringPeriodId === week && typeof s.appliedTotal === "number",
  );
  return row ? Math.round(row.appliedTotal * 100) / 100 : null;
}

/** % rostered and % started across ESPN, rounded: a market signal, not a fact about this league. */
function ownershipOf(raw: unknown): RosterEntry["ownership"] {
  if (!isObject(raw) || typeof raw.percentOwned !== "number" || typeof raw.percentStarted !== "number") return null;
  return { owned: Math.round(raw.percentOwned), started: Math.round(raw.percentStarted) };
}

/** ESPN's written outlook for this week (`outlooks.outlooksByWeek`), with the time of its last news. */
function newsOf(player: Record<string, unknown>, week: number): RosterEntry["news"] {
  const byWeek = isObject(player.outlooks) && isObject(player.outlooks.outlooksByWeek) ? player.outlooks.outlooksByWeek : {};
  const note = byWeek[String(week)];
  if (typeof note !== "string" || !note.trim()) return null;
  return { note: note.trim(), at: isoOf(player.lastNewsDate) };
}

function parseEntry(raw: unknown, season: number, week: number): RosterEntry | null {
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
    actual: actualPoints(player.stats, season, week),
    ownership: ownershipOf(player.ownership),
    news: newsOf(player, week),
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

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** A team's overall record and seed (`mTeam`), or null when ESPN sent no record. */
function parseStanding(team: Record<string, unknown>): Standing | null {
  const overall = isObject(team.record) && isObject(team.record.overall) ? team.record.overall : null;
  if (!overall) return null;
  return {
    wins: num(overall.wins),
    losses: num(overall.losses),
    ties: num(overall.ties),
    pointsFor: Math.round(num(overall.pointsFor) * 100) / 100,
    pointsAgainst: Math.round(num(overall.pointsAgainst) * 100) / 100,
    seed: typeof team.playoffSeed === "number" && team.playoffSeed > 0 ? team.playoffSeed : null,
  };
}

function parseSide(raw: unknown): MatchupSide | null {
  if (!isObject(raw) || typeof raw.teamId !== "number") return null;
  const pick = (live: unknown, settled: unknown) => Math.round(num(typeof live === "number" ? live : settled) * 100) / 100;
  return {
    teamId: raw.teamId,
    points: pick(raw.totalPointsLive, raw.totalPoints),
    projected: pick(raw.totalProjectedPointsLive, raw.totalProjectedPoints),
    winProbability: typeof raw.winProbability === "number" && raw.winProbability >= 0 && raw.winProbability <= 1 ? raw.winProbability : null,
  };
}

/** The current matchup period's fantasy matchups (`mMatchupScore`), home and away. */
export function parseMatchups(raw: unknown): Matchup[] {
  if (!isObject(raw) || !Array.isArray(raw.schedule) || !isObject(raw.status)) return [];
  const period = raw.status.currentMatchupPeriod;
  return raw.schedule.flatMap((m): Matchup[] => {
    if (!isObject(m) || m.matchupPeriodId !== period) return [];
    const home = parseSide(m.home);
    return home ? [{ home, away: parseSide(m.away) }] : [];
  });
}

/**
 * The first week of the fantasy playoffs: the first scoring period of the matchup period after the
 * regular season's last. Null when ESPN doesn't say, or the playoffs are already underway.
 */
function parsePlayoffStart(schedule: unknown, finalWeek: number): number | null {
  if (!isObject(schedule) || typeof schedule.matchupPeriodCount !== "number") return null;
  const periods = isObject(schedule.matchupPeriods) ? schedule.matchupPeriods[String(schedule.matchupPeriodCount + 1)] : undefined;
  const first = Array.isArray(periods) && typeof periods[0] === "number" ? periods[0] : schedule.matchupPeriodCount + 1;
  return first <= finalWeek ? first : null;
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

  const playoffStartWeek = parsePlayoffStart(settings.scheduleSettings, finalWeek);

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
    return [
      {
        id: t.id,
        name,
        abbrev: typeof t.abbrev === "string" ? t.abbrev : "",
        roster: entries.flatMap((e) => parseEntry(e, season, currentWeek) ?? []),
        standing: parseStanding(t),
      },
    ];
  });

  return {
    ok: true,
    league: {
      espnLeagueId,
      season,
      name: typeof settings.name === "string" ? settings.name : `ESPN league ${espnLeagueId}`,
      currentWeek,
      finalWeek,
      playoffStartWeek,
      scoringItems: parseScoringItems(isObject(settings.scoringSettings) ? settings.scoringSettings.scoringItems : undefined),
      starters,
      benchSize,
      teams,
      pendingTrades: parsePendingTrades(raw),
      tradeDeadline: isObject(settings.tradeSettings) ? isoOf(settings.tradeSettings.deadlineDate) : null,
      matchups: parseMatchups(raw),
    },
  };
}
