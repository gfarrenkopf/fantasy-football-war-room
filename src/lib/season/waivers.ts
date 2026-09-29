import { evaluateTrade, type TradeLeague } from "./trade";
import type { FreeAgent } from "./types";
import type { SeasonView, ViewPlayer } from "./view";

/**
 * Waiver-wire pickups (APE-212), scored the way trades are: each available player is added to the
 * user's roster, the weakest player by rest-of-season points is cut to make room, and the pickup is
 * worth the change in the best starting lineup's points for every remaining week. So a free agent
 * who would only ride the bench scores nothing, however good he is.
 */

export interface Pickup {
  player: ViewPlayer & Pick<FreeAgent, "status" | "waiverClears">;
  /** Best-lineup points over the rest of the season, and per remaining week. */
  delta: number;
  perWeek: number;
  /** Who the user would cut to make room; null when the roster has an open spot. */
  drop: number | null;
}

/** Below this, a pickup changes the lineup by a rounding error. */
const MIN_PER_WEEK = 0.05;
/** A team id no ESPN team has, standing in for the waiver pool. */
const POOL = -1;

export function rankPickups(view: SeasonView, pool: readonly Pickup["player"][], limit = 10): Pickup[] {
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  if (!mine) return [];
  const league: TradeLeague = view;
  return pool
    .flatMap((player): Pickup[] => {
      const verdict = evaluateTrade([mine, { id: POOL, roster: [player] }], league, { teamA: mine.id, gives: [], teamB: POOL, gets: [player.playerId] });
      if (!verdict || verdict.a.perWeek < MIN_PER_WEEK) return [];
      return [{ player, delta: verdict.a.delta, perWeek: verdict.a.perWeek, drop: verdict.a.drops[0] ?? null }];
    })
    .sort((a, b) => b.delta - a.delta || b.player.ros - a.player.ros)
    .slice(0, limit);
}
