import { ESPN_POSITIONS, PRO_TEAMS } from "@/lib/espn/proTeams";
import type { PlayerProjections, StatLine } from "./types";

/**
 * ESPN's public `kona_player_info` projections, parsed (10.1). The view is unofficial
 * (docs/espn-protocol.md §8): every field is checked, and a player we can't read is left out
 * rather than guessed at.
 */

/** ESPN's `statSourceId` for projections (0 is actual stats). */
const PROJECTED = 1;
/** ESPN's `statSplitTypeId` for a single week (0 is the season). */
const ONE_WEEK = 1;

/** The stat ids to ask `filterStatsForTopScoringPeriodIds` for: one weekly projection per week. */
export function projectionStatIds(season: number, fromWeek: number, toWeek: number): string[] {
  const out: string[] = [];
  for (let week = fromWeek; week <= toWeek; week++) out.push(`${PROJECTED}${ONE_WEEK}${season}${week}`);
  return out;
}

/** The `X-Fantasy-Filter` header for these players' weekly projections. */
export function projectionFilter(season: number, playerIds: readonly number[], fromWeek: number, toWeek: number): string {
  return JSON.stringify({
    players: {
      filterIds: { value: playerIds },
      filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: projectionStatIds(season, fromWeek, toWeek) },
    },
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function statLine(raw: unknown): StatLine | null {
  if (!isObject(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

/** One `players[]` entry of the view as projections for `season`, or null when it isn't readable. */
function parsePlayer(raw: unknown, season: number): PlayerProjections | null {
  const player = isObject(raw) && isObject(raw.player) ? raw.player : null;
  if (!player) return null;
  const { id, fullName, defaultPositionId, proTeamId, injuryStatus, stats } = player;
  if (typeof id !== "number" || typeof fullName !== "string" || typeof defaultPositionId !== "number") return null;
  const pos = ESPN_POSITIONS[defaultPositionId];
  if (!pos) return null;

  const weeks = new Map<number, StatLine>();
  for (const row of Array.isArray(stats) ? stats : []) {
    if (!isObject(row) || row.statSourceId !== PROJECTED || row.statSplitTypeId !== ONE_WEEK || row.seasonId !== season) continue;
    const week = row.scoringPeriodId;
    const line = statLine(row.stats);
    if (typeof week === "number" && week > 0 && line) weeks.set(week, line);
  }

  return {
    id,
    name: fullName,
    pos,
    team: typeof proTeamId === "number" ? (PRO_TEAMS[proTeamId] ?? null) : null,
    injuryStatus: typeof injuryStatus === "string" ? injuryStatus : "ACTIVE",
    weeks,
  };
}

/** Parses the view's response. Throws only when it isn't the view at all. */
export function parseProjections(raw: unknown, season: number): PlayerProjections[] {
  if (!isObject(raw) || !Array.isArray(raw.players)) throw new Error("ESPN projections: expected { players: [...] }");
  return raw.players.flatMap((p) => parsePlayer(p, season) ?? []);
}
