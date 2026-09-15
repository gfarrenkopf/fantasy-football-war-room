import { myPlayers, positionCounts } from "../roster";
import { roundOf } from "../snake";
import type { DraftPick, Player } from "../types";
import { survival, type AvailabilityResult } from "./availability";
import type { SimContext } from "./context";
import { bestOnBoard } from "./cpu";

export interface PlanEntry {
  player: Player;
  /** Chance he's still available at the turn (0..1). */
  survival: number;
}

export interface TurnPlan {
  /** Pick numbers in this turn, e.g. [24, 25]. */
  picks: number[];
  /** The best players likely to be there (≥ 60%), in priority order. */
  targets: PlanEntry[];
  /** The next best who may be there (≥ 30%): take them if the targets are gone. */
  fallbacks: PlanEntry[];
  /** Players ranked around this pick who probably won't survive to it (< 30%). Don't plan around them. */
  letGo: PlanEntry[];
}

export const TARGET_ODDS = 0.6;
export const FALLBACK_ODDS = 0.3;
/** How far down the needs-adjusted board to look. */
const SCAN = 60;
const MAX = { targets: 4, fallbacks: 4, letGo: 3 };

/**
 * The free-tier turn plan, replacing the prototype's hand-written PLAN. For one of the user's
 * upcoming turns, walk down the board in needs-adjusted order (as a sharp drafter would score
 * players for the user's roster in that round):
 * - targets: the first players with ≥ 60% odds of surviving to the turn;
 * - fallbacks: the next players with ≥ 30% odds;
 * - let go: players ranked within half a round before the pick who will likely be gone, i.e. the
 *   tempting names that shouldn't be counted on (obviously-gone stars aren't listed).
 * Players the user's own simulated earlier picks usually take are skipped.
 */
export function computeTurnPlan(picks: DraftPick[], odds: AvailabilityResult, ctx: SimContext, turn = 0): TurnPlan | null {
  const turnPicks = odds.turns[turn];
  if (!turnPicks) return null;

  const counts = positionCounts(myPlayers(picks, (id) => ctx.byId.get(id)));
  const taken = new Set(picks.map((p) => p.playerId));
  // Players the user's own earlier auto-picks usually take aren't really available to plan around.
  const skip = new Set([...odds.players].filter(([, o]) => o.mine[turn] >= 0.5).map(([id]) => id));
  const round = roundOf(turnPicks[0], ctx.league.teams);

  const letGoFromRank = turnPicks[0] - ctx.league.teams / 2;

  const plan: TurnPlan = { picks: turnPicks, targets: [], fallbacks: [], letGo: [] };
  for (const player of bestOnBoard(taken, counts, round, ctx, SCAN, skip)) {
    const o = odds.players.get(player.id);
    const entry = { player, survival: o ? survival(o, turn) : 0 };
    if (entry.survival >= TARGET_ODDS && plan.targets.length < MAX.targets) plan.targets.push(entry);
    else if (entry.survival >= FALLBACK_ODDS && plan.fallbacks.length < MAX.fallbacks) plan.fallbacks.push(entry);
    else if (entry.survival < FALLBACK_ODDS && player.consensusRank >= letGoFromRank && plan.letGo.length < MAX.letGo) plan.letGo.push(entry);
    if (plan.targets.length === MAX.targets && plan.fallbacks.length === MAX.fallbacks) break;
  }
  return plan;
}

/** Plans for all of the user's remaining turns. */
export const computeAllTurnPlans = (picks: DraftPick[], odds: AvailabilityResult, ctx: SimContext): TurnPlan[] =>
  odds.turns.map((_, i) => computeTurnPlan(picks, odds, ctx, i)).filter((p): p is TurnPlan => p !== null);
