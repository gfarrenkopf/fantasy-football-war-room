/**
 * How close ESPN's projections came (APE-229): its pre-game numbers for the user's matchup and
 * players, against what was scored. Stored by src/lib/server/seasonProjections.ts; plain JSON so the
 * page can hand it to the client.
 */

export interface ProjectionCall {
  /** ESPN's projection when the first game that counted kicked off. */
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
  season: { weeks: number; meanMiss: number; meanBias: number } | null;
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
