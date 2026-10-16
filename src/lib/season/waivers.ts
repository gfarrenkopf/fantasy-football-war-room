import type { Position } from "@/lib/draft/types";
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

/**
 * What one available player is worth to the user's best lineup, whatever it comes to: a player found
 * by search (APE-409) shows his value even when it's nothing. Null when the view has no team of the user's.
 */
export function valuePickup(view: SeasonView, player: Pickup["player"]): Pickup | null {
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  if (!mine) return null;
  const league: TradeLeague = view;
  const verdict = evaluateTrade([mine, { id: POOL, roster: [player] }], league, { teamA: mine.id, gives: [], teamB: POOL, gets: [player.playerId] });
  if (!verdict) return null;
  return { player, delta: verdict.a.delta, perWeek: verdict.a.perWeek, drop: verdict.a.drops[0] ?? null };
}

export function rankPickups(view: SeasonView, pool: readonly Pickup["player"][], limit = 10): Pickup[] {
  return pool
    .flatMap((player): Pickup[] => {
      const pickup = valuePickup(view, player);
      return pickup && pickup.perWeek >= MIN_PER_WEEK ? [pickup] : [];
    })
    .sort((a, b) => b.delta - a.delta || b.player.ros - a.player.ros)
    .slice(0, limit);
}

/** A player already on a team in the league, found by a name search (APE-413): whose team, to trade with. */
export interface Rostered {
  player: ViewPlayer;
  teamId: number;
  team: string;
  /** On the user's own team: nothing to trade for. */
  mine: boolean;
}

/**
 * Whether a name matches a search the way ESPN's `filterName` does (docs/espn-protocol.md §8): the
 * start of any word in the name, or of the whole name, ignoring case.
 */
export function nameMatches(name: string, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return false;
  const full = name.toLowerCase();
  return full.startsWith(q) || full.split(/\s+/).some((word) => word.startsWith(q));
}

/** The league's rostered players whose names match a search, at `position` when given, most-rostered across ESPN first. */
export function rosteredMatching(view: Pick<SeasonView, "teams" | "myTeamId">, search: string, position?: Position): Rostered[] {
  return view.teams
    .flatMap((t) => t.roster.filter((p) => nameMatches(p.name, search) && (!position || p.pos === position)).map((player) => ({ player, teamId: t.id, team: t.name, mine: t.id === view.myTeamId })))
    .sort((a, b) => (b.player.ownership?.owned ?? -1) - (a.player.ownership?.owned ?? -1));
}

/** "Waiver priority 4 of 12", or FAAB left in a league that bids; null when ESPN gave neither. */
export function waiverNote(view: Pick<SeasonView, "waiver" | "teams">): string | null {
  const { rank, budget, left } = view.waiver;
  if (budget !== null && left !== null) return `$${left} of $${budget} FAAB left`;
  return rank ? `Waiver priority ${rank} of ${view.teams.length}` : null;
}
