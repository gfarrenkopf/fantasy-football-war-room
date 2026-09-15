import { myTurns } from "../snake";
import type { CpuStyle, DraftPick } from "../types";
import type { SimContext } from "./context";
import type { Rng } from "./rng";
import { simulateFrom } from "./simulate";

export interface PlayerOdds {
  /** Per upcoming turn: share of mocks where the player is still available at the turn's first pick. */
  available: number[];
  /** Per upcoming turn: share of mocks where the user's auto-picks already took him before that turn. */
  mine: number[];
}

export interface AvailabilityResult {
  /** Mocks run. */
  n: number;
  /** The user's remaining turns (back-to-back picks grouped), from the current pick. */
  turns: number[][];
  /** Odds for every player available when the run started. */
  players: Map<string, PlayerOdds>;
  elapsedMs: number;
}

/**
 * "Would he survive to my pick?" The prototype's report math: the chance he is still on the board,
 * among mocks where the user didn't already draft him. 0 when the user always takes him first.
 */
export function survival(odds: PlayerOdds, turn: number): number {
  const notMine = 1 - odds.mine[turn];
  return notMine > 0 ? Math.min(1, odds.available[turn] / notMine) : 0;
}

/**
 * Monte Carlo availability: runs `n` full mocks from the current picks (CPU room plus auto-picks
 * for the user) and records, for each available player, how often he survives to each of the
 * user's upcoming turns. Ported from the prototype's runReport() (math only; UI renders it).
 */
export function survivalOdds(picks: DraftPick[], room: CpuStyle[], ctx: SimContext, { n, rng }: { n: number; rng: Rng }): AvailabilityResult {
  const start = performance.now();
  const turns = myTurns(ctx.league, picks.length + 1);
  const firstPicks = turns.map((t) => t[0]);
  const taken = new Set(picks.map((p) => p.playerId));
  const pool = ctx.players.filter((p) => !taken.has(p.id));
  const index = new Map(pool.map((p, i) => [p.id, i]));

  const T = firstPicks.length;
  const available = new Uint32Array(pool.length * T);
  const mine = new Uint32Array(pool.length * T);
  const takenAt = new Int32Array(pool.length);
  const byMe = new Uint8Array(pool.length);

  for (let k = 0; k < n; k++) {
    takenAt.fill(0);
    byMe.fill(0);
    const result = simulateFrom(picks, room, ctx, { autoMe: true, rng });
    for (let i = picks.length; i < result.length; i++) {
      const at = index.get(result[i].playerId);
      if (at === undefined) continue;
      takenAt[at] = i + 1;
      byMe[at] = result[i].mine ? 1 : 0;
    }
    for (let p = 0; p < pool.length; p++) {
      const t = takenAt[p];
      for (let j = 0; j < T; j++) {
        if (!t || t >= firstPicks[j]) available[p * T + j]++;
        else if (byMe[p]) mine[p * T + j]++;
      }
    }
  }

  const players = new Map<string, PlayerOdds>();
  pool.forEach((p, i) => {
    const row = (arr: Uint32Array) => Array.from({ length: T }, (_, j) => (n ? arr[i * T + j] / n : 0));
    players.set(p.id, { available: row(available), mine: row(mine) });
  });
  return { n, turns, players, elapsedMs: performance.now() - start };
}
