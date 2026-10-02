import { SLOT_DEFS } from "@/lib/draft/league";
import type { Position } from "@/lib/draft/types";
import { afterTrade, evaluateTrade, type Trade, type TradeLeague, type TradeVerdict } from "./trade";
import type { LineupSlotCount } from "./types";
import type { SeasonView, ViewPlayer, ViewTeam } from "./view";

/**
 * Trade ideas (APE-222): trades the user could offer, found by searching every roster in the league
 * and graded the way the trade verdict (10.6) grades them, by the change in each team's best starting
 * lineup for the rest of the season. Two kinds come back: safe ones, where the partner's lineup
 * doesn't get worse either, so they'd plausibly accept, and bold ones, which gain the user more while
 * costing the partner a little.
 *
 * Every 1-for-1 to 2-for-2 in a 16-team league is millions of trades, so the search narrows first:
 * each player is valued alone, and only the most promising handful per side and per partner go into
 * combinations. Those combinations are then graded exactly. Every lineup solve counts against a
 * budget, so the search's cost has a hard ceiling.
 */

export type IdeaKind = "safe" | "bold";

export interface TradeCandidate {
  kind: IdeaKind;
  /** teamA is the user's team. */
  trade: Trade;
  /** Best-lineup points per remaining week, for the user and for the partner. */
  you: number;
  them: number;
  weeks: number;
}

export interface SearchLimits {
  /** The user's players offered: the best this many by rest-of-season points. */
  givePool: number;
  /** Per partner, how many of each side's players go into combinations. */
  perPartner: number;
  /** Ideas kept per kind. */
  shortlist: number;
  /** Lineup solves (each one a season of weekly lineups), at most. */
  maxLineups: number;
}

export const DEFAULT_LIMITS: SearchLimits = { givePool: 10, perPartner: 6, shortlist: 4, maxLineups: 20_000 };

/** Below this, a trade changes the user's lineup by a rounding error (the same bar as waiver pickups). */
export const MIN_GAIN = 0.05;
/** A bold idea may cost the partner up to this much a week: their verdict reads "Slightly worse". */
export const BOLD_FLOOR = -0.5;
/** Two ideas this close, per week on both sides, are the same idea; the simpler one is kept. */
const SAME = 0.1;
/** Sums of points in a different order differ in the last bits; this much below zero is zero. */
const EPSILON = 1e-9;
/** How many of a kind may name the same partner. */
const PER_PARTNER_IDEAS = 2;

export interface TradeSearch {
  safe: TradeCandidate[];
  bold: TradeCandidate[];
  stats: { lineups: number; combos: number; truncated: boolean };
}

const ELIGIBLE = new Map(SLOT_DEFS.map((d) => [d.key, d.eligible]));

/**
 * The best lineup's points over the rest of the season: the same number `seasonLineup` in trade.ts
 * gets from the assignment solver, found greedily. Every flex slot takes a superset of the positions
 * of the narrower slots (a position, then FLEX, then SUPERFLEX), so filling the narrowest slots first
 * with the best eligible player left is optimal, and far cheaper.
 */
export function lineupTotal(roster: readonly ViewPlayer[], league: TradeLeague): number {
  const slots = slotOrder(league.starters);
  let total = 0;
  for (let week = league.currentWeek; week <= league.finalWeek; week++) {
    const byPoints = [...roster].sort((a, b) => (b.weekly[week] ?? 0) - (a.weekly[week] ?? 0));
    const used = new Set<number>();
    for (const eligible of slots) {
      const pick = byPoints.find((p) => !used.has(p.playerId) && eligible.includes(p.pos));
      if (!pick) continue;
      used.add(pick.playerId);
      total += pick.weekly[week] ?? 0;
    }
  }
  return total;
}

const orders = new WeakMap<readonly LineupSlotCount[], Position[][]>();
function slotOrder(starters: readonly LineupSlotCount[]): Position[][] {
  let order = orders.get(starters);
  if (!order) {
    order = starters.flatMap((s) => Array.from({ length: s.count }, () => ELIGIBLE.get(s.key) ?? [])).sort((a, b) => a.length - b.length);
    orders.set(starters, order);
  }
  return order;
}

/** Players ESPN would let move in a new trade: not barred, not on IR, not already in a pending one. */
export function tradeablePlayers(view: SeasonView, team: ViewTeam): ViewPlayer[] {
  const pending = new Set(view.pendingTrades.flatMap((t) => t.moves.map((m) => m.playerId)));
  return team.roster.filter((p) => !p.tradeLocked && p.slot !== "IR" && !pending.has(p.playerId));
}

const ids = (players: readonly ViewPlayer[]) => players.map((p) => p.playerId);
/** Every group of one or two. */
const upToTwo = <T>(list: readonly T[]): T[][] => [...list.map((x) => [x]), ...list.flatMap((x, i) => list.slice(i + 1).map((y) => [x, y]))];
const byId = (a: ViewPlayer, b: ViewPlayer) => a.playerId - b.playerId;

export function findTradeIdeas(view: SeasonView, limits: SearchLimits = DEFAULT_LIMITS): TradeSearch {
  const stats = { lineups: 0, combos: 0, truncated: false };
  const weeks = Math.max(0, view.finalWeek - view.currentWeek + 1);
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  const partners = view.teams.filter((t) => t.id !== view.myTeamId);
  if (view.tradeDeadlinePassed || !weeks || !mine || !partners.length) return { safe: [], bold: [], stats };

  // Every lineup solve goes through here. Null once the budget is spent.
  const value = (roster: readonly ViewPlayer[]): number | null => {
    if (stats.lineups >= limits.maxLineups) {
      stats.truncated = true;
      return null;
    }
    stats.lineups++;
    return lineupTotal(roster, view);
  };
  /** A team's change per week from sending `out` and receiving `incoming`, cut to fit as the verdict cuts. */
  const change = (team: ViewTeam, base: number, out: readonly ViewPlayer[], incoming: readonly ViewPlayer[]) => {
    const after = value(afterTrade(team.roster, new Set(ids(out)), incoming, view).roster);
    return after === null ? null : (after - base) / weeks;
  };
  /** One player's worth to a lineup, alone: what adding him gains, or losing him costs. */
  const gainOf = (team: ViewTeam, base: number, p: ViewPlayer) => {
    const after = value([...team.roster, p]);
    return after === null ? null : after - base;
  };
  const lossOf = (team: ViewTeam, base: number, p: ViewPlayer) => {
    const after = value(team.roster.filter((x) => x.playerId !== p.playerId));
    return after === null ? null : base - after;
  };

  const myBase = value(mine.roster)!;
  const pool = tradeablePlayers(view, mine)
    .sort((a, b) => b.ros - a.ros || byId(a, b))
    .slice(0, limits.givePool);
  const myLoss = new Map<number, number>();
  for (const p of pool) {
    const loss = lossOf(mine, myBase, p);
    if (loss === null) break;
    myLoss.set(p.playerId, loss);
  }

  const found: TradeCandidate[] = [];
  for (const partner of partners) {
    const base = value(partner.roster);
    if (base === null) break;

    // Their players by surplus: what each adds to the user's lineup less what losing him costs them.
    // A star they start helps the user most, but costs them as much.
    const surplus = new Map<number, number>();
    for (const q of tradeablePlayers(view, partner).filter((p) => p.ros > 0)) {
      const gain = gainOf(mine, myBase, q);
      if (gain === null) break;
      if (gain <= 0) continue;
      const loss = lossOf(partner, base, q);
      if (loss === null) break;
      surplus.set(q.playerId, gain - loss);
    }
    // The user's players the same way, from the partner's side.
    const theirSurplus = new Map<number, number>();
    for (const p of pool.filter((p) => myLoss.has(p.playerId))) {
      const gain = gainOf(partner, base, p);
      if (gain === null) break;
      theirSurplus.set(p.playerId, gain - myLoss.get(p.playerId)!);
    }
    if (stats.truncated) break;

    const top = (players: readonly ViewPlayer[], score: Map<number, number>) =>
      players
        .filter((p) => score.has(p.playerId))
        .sort((a, b) => score.get(b.playerId)! - score.get(a.playerId)! || byId(a, b))
        .slice(0, limits.perPartner)
        .sort(byId);
    const gets = top(partner.roster, surplus);
    const offers = top(pool, theirSurplus);

    // Every 1-for-1 to 2-for-2 among them, graded exactly: the user's side first, and the partner's
    // only if the user gains.
    for (const send of upToTwo(offers)) {
      for (const get of upToTwo(gets)) {
        stats.combos++;
        const you = change(mine, myBase, send, get);
        if (you === null) break;
        if (you < MIN_GAIN) continue;
        const them = change(partner, base, get, send);
        if (them === null) break;
        if (them < BOLD_FLOOR) continue;
        found.push({ kind: them > -EPSILON ? "safe" : "bold", trade: { teamA: mine.id, gives: ids(send), teamB: partner.id, gets: ids(get) }, you, them, weeks });
      }
      if (stats.truncated) break;
    }
    if (stats.truncated) break;
  }

  const simplest = withoutPadding(found);
  const byGain = (a: TradeCandidate, b: TradeCandidate) => b.you - a.you || b.them - a.them || size(a) - size(b) || a.trade.teamB - b.trade.teamB;
  const safe = shortlist(simplest.filter((c) => c.kind === "safe").sort(byGain), limits.shortlist);
  const best = safe[0]?.you ?? 0;
  // A bold idea has to earn its cost to the partner by beating the best safe one for the user.
  const bold = shortlist(simplest.filter((c) => c.kind === "bold" && c.you > best + MIN_GAIN).sort(byGain), limits.shortlist);
  return { safe, bold, stats };
}

const size = (c: TradeCandidate) => c.trade.gives.length + c.trade.gets.length;

/** Drops a trade that only adds players to a simpler one with the same partner, for about the same result. */
function withoutPadding(found: readonly TradeCandidate[]): TradeCandidate[] {
  const within = (a: readonly number[], b: readonly number[]) => a.every((id) => b.includes(id));
  return found.filter(
    (c) =>
      !found.some(
        (d) =>
          d !== c &&
          d.trade.teamB === c.trade.teamB &&
          size(d) < size(c) &&
          within(d.trade.gives, c.trade.gives) &&
          within(d.trade.gets, c.trade.gets) &&
          Math.abs(d.you - c.you) <= SAME &&
          Math.abs(d.them - c.them) <= SAME,
      ),
  );
}

function shortlist(sorted: readonly TradeCandidate[], limit: number): TradeCandidate[] {
  const out: TradeCandidate[] = [];
  const perPartner = new Map<number, number>();
  for (const c of sorted) {
    const n = perPartner.get(c.trade.teamB) ?? 0;
    if (n >= PER_PARTNER_IDEAS) continue;
    out.push(c);
    perPartner.set(c.trade.teamB, n + 1);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Where a stored idea stands now. Rosters change through the week, so the page grades ideas again
 * when it shows them: a player may have moved (stale), be caught up in another trade (blocked), or
 * the user may already have offered it (offered).
 */
export type IdeaStatus =
  | { kind: "ok"; verdict: TradeVerdict }
  | { kind: "stale"; missing: number[] }
  | { kind: "blocked"; ids: number[]; verdict: TradeVerdict }
  | { kind: "offered"; pendingId: string; verdict: TradeVerdict };

export function ideaStatus(view: SeasonView, trade: Trade): IdeaStatus {
  const mine = view.teams.find((t) => t.id === trade.teamA);
  const partner = view.teams.find((t) => t.id === trade.teamB);
  const off = (team: ViewTeam | undefined, list: readonly number[]) => list.filter((id) => !team?.roster.some((p) => p.playerId === id));
  const missing = [...off(mine, trade.gives), ...off(partner, trade.gets)];
  const verdict = missing.length ? null : evaluateTrade(view.teams, view, trade);
  if (!verdict || !mine || !partner) return { kind: "stale", missing };

  const moving = new Set([...trade.gives, ...trade.gets]);
  const offered = view.pendingTrades.find(
    (t) => t.proposerTeamId === trade.teamA && t.partnerTeamId === trade.teamB && t.moves.length === moving.size && t.moves.every((m) => moving.has(m.playerId)),
  );
  if (offered) return { kind: "offered", pendingId: offered.id, verdict };

  const free = new Set([...tradeablePlayers(view, mine), ...tradeablePlayers(view, partner)].map((p) => p.playerId));
  const blocked = [...moving].filter((id) => !free.has(id));
  return blocked.length ? { kind: "blocked", ids: blocked, verdict } : { kind: "ok", verdict };
}
