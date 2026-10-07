/**
 * How close ESPN's projections came (APE-229): its pre-game numbers for the user's matchup and
 * players, against what was scored. Stored by src/lib/server/seasonProjections.ts; plain JSON so the
 * page can hand it to the client.
 */

export interface ProjectionCall {
  /** ESPN's pre-game projection: a player's at his kickoff, a team's the sum of its starters'. */
  projected: number;
  /** Points scored, once final; null until then. */
  actual: number | null;
}

export interface PlayerCall extends ProjectionCall {
  playerId: number;
}

export interface ProjectionAccuracy {
  me: ProjectionCall | null;
  them: ProjectionCall | null;
  /** The user's players this week, as far as War Room saw them before kickoff. */
  players: PlayerCall[];
  /** The user's team over the season's settled weeks before this one, or null with none. */
  season: SeasonCalls | null;
}

/** How far ESPN's calls have run from the scores over several weeks: the average miss, and its lean (positive when ESPN called too low). */
export interface CallRecord {
  weeks: number;
  meanMiss: number;
  meanBias: number;
}

/** ESPN's season on the user's team (APE-306): the team's record, how often ESPN called it too high, and each player's own. */
export interface SeasonCalls extends CallRecord {
  /** Weeks ESPN projected the team for more than it scored. */
  overcalled: number;
  /** Each player who played for the user in those weeks. */
  players: (CallRecord & { playerId: number })[];
}

/** A player needs this many settled weeks before he's called ESPN's surest or shakiest read. */
const TRACK_MIN_WEEKS = 2;

/**
 * Among the players in `keep` (the roster now), the one ESPN has read most closely this season and
 * the one it has missed by most. Null for either with fewer than two such players, or when the two are the same.
 */
export function trackRecord(season: SeasonCalls, keep: ReadonlySet<number>): { surest: SeasonCalls["players"][number]; shakiest: SeasonCalls["players"][number] } | null {
  const seen = season.players.filter((p) => keep.has(p.playerId) && p.weeks >= TRACK_MIN_WEEKS).sort((a, b) => a.meanMiss - b.meanMiss || b.weeks - a.weeks);
  if (seen.length < 2) return null;
  const surest = seen[0];
  const shakiest = seen.at(-1)!;
  return surest.meanMiss === shakiest.meanMiss ? null : { surest, shakiest };
}

/** The player who most beat his pre-game projection, and the one who most fell short, among finished games. */
export function biggestSurprises(players: readonly PlayerCall[]): { best: PlayerCall | null; worst: PlayerCall | null } {
  const done = players.filter((p): p is PlayerCall & { actual: number } => p.actual !== null);
  const gap = (p: { projected: number; actual: number }) => p.actual - p.projected;
  const sorted = [...done].sort((a, b) => gap(b) - gap(a));
  const best = sorted[0] && gap(sorted[0]) > 0 ? sorted[0] : null;
  const last = sorted.at(-1);
  const worst = last && gap(last) < 0 ? last : null;
  return { best, worst };
}
