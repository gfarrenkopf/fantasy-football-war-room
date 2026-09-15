import type { LeagueSettings } from "./types";

/**
 * Snake-draft position math. Pick numbers are 1-based overall picks.
 * Odd rounds go slot 1 → teams, even rounds go teams → 1.
 */

type DraftShape = Pick<LeagueSettings, "teams" | "mySlot" | "roster">;

export const roundsOf = (league: Pick<LeagueSettings, "roster">): number => league.roster.length;

export const totalPicks = (league: Pick<LeagueSettings, "teams" | "roster">): number =>
  league.teams * roundsOf(league);

export const roundOf = (n: number, teams: number): number => Math.ceil(n / teams);

/** Position within the round, 1..teams, in the order picks are made. */
export const pickInRound = (n: number, teams: number): number => ((n - 1) % teams) + 1;

/** Draft slot (1..teams) that owns overall pick n. */
export function slotOf(n: number, teams: number): number {
  const p = pickInRound(n, teams);
  return roundOf(n, teams) % 2 === 1 ? p : teams + 1 - p;
}

export const isMyPick = (n: number, league: DraftShape): boolean =>
  n >= 1 && n <= totalPicks(league) && slotOf(n, league.teams) === league.mySlot;

/**
 * First pick at or after n that belongs to the user.
 * Returns totalPicks + 1 when the user has no picks left (the prototype's sentinel).
 */
export function nextMyPick(n: number, league: DraftShape): number {
  const total = totalPicks(league);
  let x = Math.max(1, n);
  while (x <= total && !isMyPick(x, league)) x++;
  return x;
}

/** All of the user's pick numbers from `from` (inclusive) to the end of the draft. */
export function myPickNumbers(league: DraftShape, from = 1): number[] {
  const out: number[] = [];
  for (let n = nextMyPick(from, league); n <= totalPicks(league); n = nextMyPick(n + 1, league)) {
    out.push(n);
  }
  return out;
}

/**
 * The user's picks grouped into turns: back-to-back picks at the snake wrap
 * form one turn, e.g. slot 1 in a 12-team league → [1], [24, 25], [48, 49], ...
 */
export function myTurns(league: DraftShape, from = 1): number[][] {
  const turns: number[][] = [];
  for (const n of myPickNumbers(league, from)) {
    const last = turns.at(-1);
    if (last && last.at(-1) === n - 1) last.push(n);
    else turns.push([n]);
  }
  return turns;
}

/** "round.pick" label, e.g. pick 25 in a 12-team league → "3.01". */
export const formatRoundPick = (n: number, teams: number): string =>
  `${roundOf(n, teams)}.${String(pickInRound(n, teams)).padStart(2, "0")}`;
