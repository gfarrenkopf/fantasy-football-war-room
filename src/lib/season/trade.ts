import { optimalLineup } from "./lineup";
import type { LineupSlotCount, PendingTrade } from "./types";
import type { ViewPlayer } from "./view";

/**
 * The trade verdict (10.6): what a trade does to each team's starting lineup for the rest of the
 * season, not what the players are worth in a vacuum. For every remaining week, each team's best
 * legal lineup is set before and after the trade, and the verdict is the difference in their summed
 * points. So a 2-for-1 that only moves a bench player counts for little, and a trade that leaves a
 * team without a starting TE shows up as the hole it is. Byes count as zero, which is how they hurt.
 */

export interface TradeTeam {
  id: number;
  roster: readonly ViewPlayer[];
}

export interface TradeLeague {
  starters: readonly LineupSlotCount[];
  benchSize: number;
  currentWeek: number;
  finalWeek: number;
}

export interface Trade {
  /** Two different teams, and the players each sends the other. */
  teamA: number;
  gives: readonly number[];
  teamB: number;
  gets: readonly number[];
}

export interface SlotChange {
  key: LineupSlotCount["key"];
  /** Average points per remaining week from this slot, before and after. */
  before: number;
  after: number;
}

export interface TeamVerdict {
  teamId: number;
  /** Best-lineup points over the rest of the season, before and after. */
  before: number;
  after: number;
  delta: number;
  /** Per remaining week. */
  perWeek: number;
  bySlot: SlotChange[];
  /** Who they'd have to cut to fit the roster: the lowest rest-of-season value. */
  drops: number[];
}

export interface TradeVerdict {
  weeks: number;
  a: TeamVerdict;
  b: TeamVerdict;
}

/** Best-lineup points for each remaining week, and per slot key. */
function seasonLineup(roster: readonly ViewPlayer[], league: TradeLeague): { total: number; bySlot: Map<string, number> } {
  const bySlot = new Map<string, number>();
  let total = 0;
  for (let week = league.currentWeek; week <= league.finalWeek; week++) {
    // Every week is set afresh: who's healthy and who's locked is a this-week question, and future
    // weeks' projections already carry ESPN's expectations.
    const candidates = roster.map((p) => ({ playerId: p.playerId, pos: p.pos, slot: "BN" as const, locked: false, injuryStatus: "ACTIVE", points: p.weekly[week] ?? 0 }));
    const plan = optimalLineup(candidates, league.starters);
    total += plan.total;
    for (const s of plan.starters) bySlot.set(s.key, (bySlot.get(s.key) ?? 0) + s.points);
  }
  return { total, bySlot };
}

/** The roster after sending `out` and receiving `in`, cut to fit, and who was cut. */
function afterTrade(roster: readonly ViewPlayer[], out: ReadonlySet<number>, incoming: readonly ViewPlayer[], league: TradeLeague) {
  const kept = [...roster.filter((p) => !out.has(p.playerId)), ...incoming];
  const capacity = league.starters.reduce((n, s) => n + s.count, 0) + league.benchSize;
  // IR doesn't count against the roster.
  const counted = kept.filter((p) => p.slot !== "IR");
  const over = counted.length - Math.max(capacity, roster.filter((p) => p.slot !== "IR").length);
  if (over <= 0) return { roster: kept, drops: [] as number[] };
  const drops = [...counted].sort((x, y) => x.ros - y.ros || x.playerId - y.playerId).slice(0, over).map((p) => p.playerId);
  const cut = new Set(drops);
  return { roster: kept.filter((p) => !cut.has(p.playerId)), drops };
}

function verdictFor(team: TradeTeam, out: ReadonlySet<number>, incoming: readonly ViewPlayer[], league: TradeLeague, weeks: number): TeamVerdict {
  const before = seasonLineup(team.roster, league);
  const next = afterTrade(team.roster, out, incoming, league);
  const after = seasonLineup(next.roster, league);
  return {
    teamId: team.id,
    before: before.total,
    after: after.total,
    delta: after.total - before.total,
    perWeek: weeks ? (after.total - before.total) / weeks : 0,
    bySlot: league.starters.map((s) => ({ key: s.key, before: (before.bySlot.get(s.key) ?? 0) / weeks, after: (after.bySlot.get(s.key) ?? 0) / weeks })),
    drops: next.drops,
  };
}

/** A pending ESPN trade as a Trade from `myTeamId`'s side, or null if the user isn't in it. */
export function tradeFromPending(pending: PendingTrade, myTeamId: number): Trade | null {
  if (pending.proposerTeamId !== myTeamId && pending.partnerTeamId !== myTeamId) return null;
  const partner = pending.proposerTeamId === myTeamId ? pending.partnerTeamId : pending.proposerTeamId;
  return {
    teamA: myTeamId,
    gives: pending.moves.filter((m) => m.fromTeamId === myTeamId).map((m) => m.playerId),
    teamB: partner,
    gets: pending.moves.filter((m) => m.fromTeamId === partner).map((m) => m.playerId),
  };
}

export function evaluateTrade(teams: readonly TradeTeam[], league: TradeLeague, trade: Trade): TradeVerdict | null {
  const a = teams.find((t) => t.id === trade.teamA);
  const b = teams.find((t) => t.id === trade.teamB);
  if (!a || !b || a.id === b.id || (!trade.gives.length && !trade.gets.length)) return null;
  const gives = new Set(trade.gives);
  const gets = new Set(trade.gets);
  const sent = a.roster.filter((p) => gives.has(p.playerId));
  const received = b.roster.filter((p) => gets.has(p.playerId));
  if (sent.length !== gives.size || received.length !== gets.size) return null;
  const weeks = Math.max(0, league.finalWeek - league.currentWeek + 1);
  return { weeks, a: verdictFor(a, gives, received, league, weeks), b: verdictFor(b, gets, sent, league, weeks) };
}
