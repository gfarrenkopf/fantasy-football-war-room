import { rosterLimit } from "./acquire";
import type { Trade } from "./trade";
import type { LineupSlotCount, PendingTrade } from "./types";

/**
 * Trades on ESPN from War Room (13.5): proposing the builder's trade, and accepting, declining or
 * withdrawing a pending one. Pure: the checks the browser runs before the user confirms, and the
 * server runs again on a fresh read (docs/espn-protocol.md §8, "Roster transactions").
 *
 * ESPN only checks the proposer's roster size when a trade is proposed, so a proposal that leaves
 * the user over the limit carries `DROP` items; the partner makes room when they accept.
 */

export type TradeAction = "accept" | "decline" | "withdraw";

/** `TRADE` and `DROP` items of a `TRADE_PROPOSAL`. */
export type EspnTradeItem = { playerId: number; type: "TRADE"; fromTeamId: number; toTeamId: number } | { playerId: number; type: "DROP"; fromTeamId: number };

interface TradeRoster {
  id: number;
  roster: readonly { playerId: number; name: string; slot: string; tradeLocked?: boolean }[];
}

interface TradeRules {
  starters: readonly LineupSlotCount[];
  benchSize: number;
  tradeDeadline: string | null;
}

const pastDeadline = (rules: TradeRules, now: number) => !!rules.tradeDeadline && now > Date.parse(rules.tradeDeadline);

/** How many players a roster carries outside IR after a trade: out go `gives` and `drops`, in come `gets`. */
const countAfter = (team: TradeRoster, gives: readonly number[], gets: readonly number[], drops: readonly number[] = []) => {
  const out = new Set([...gives, ...drops]);
  return team.roster.filter((p) => p.slot !== "IR" && !out.has(p.playerId)).length + gets.length;
};

/** Why this proposal can't go to ESPN, in words for the user; empty when it can. `drops` are the user's own. */
export function checkProposal(teams: readonly TradeRoster[], rules: TradeRules, trade: Trade, drops: readonly number[], now: number): string[] {
  const problems: string[] = [];
  if (pastDeadline(rules, now)) problems.push("The trade deadline has passed.");
  const mine = teams.find((t) => t.id === trade.teamA);
  const theirs = teams.find((t) => t.id === trade.teamB);
  if (!mine || !theirs || mine.id === theirs.id) return [...problems, "That team isn't in this league."];
  if (!trade.gives.length && !trade.gets.length) problems.push("Pick at least one player.");
  const check = (team: TradeRoster, ids: readonly number[], whose: string) => {
    for (const id of ids) {
      const p = team.roster.find((x) => x.playerId === id);
      if (!p) problems.push(`A player you picked isn't on ${whose} roster any more.`);
      else if (p.tradeLocked) problems.push(`${p.name} is already in a trade, or can't be traded right now.`);
    }
  };
  check(mine, trade.gives, "your");
  check(theirs, trade.gets, "their");
  for (const id of drops) {
    if (!mine.roster.some((p) => p.playerId === id) || trade.gives.includes(id)) problems.push("A player you're dropping isn't yours to drop.");
  }
  const limit = rosterLimit(rules.starters, rules.benchSize);
  if (countAfter(mine, trade.gives, trade.gets, drops) > limit) problems.push(`That leaves you over ${limit} players. Drop someone too.`);
  return problems;
}

export function proposalItems(trade: Trade, drops: readonly number[]): EspnTradeItem[] {
  return [
    ...trade.gives.map((playerId) => ({ playerId, type: "TRADE" as const, fromTeamId: trade.teamA, toTeamId: trade.teamB })),
    ...trade.gets.map((playerId) => ({ playerId, type: "TRADE" as const, fromTeamId: trade.teamB, toTeamId: trade.teamA })),
    ...drops.map((playerId) => ({ playerId, type: "DROP" as const, fromTeamId: trade.teamA })),
  ];
}

/**
 * Why the user can't act on this pending trade, in words; empty when they can. Accepting and
 * declining answer someone else's offer; withdrawing takes back the user's own.
 */
export function checkResponse(pending: readonly PendingTrade[], teams: readonly TradeRoster[], rules: TradeRules, myTeamId: number, tradeId: string, action: TradeAction, now: number): string[] {
  const t = pending.find((x) => x.id === tradeId);
  if (!t || t.status !== "proposed") return ["That offer isn't open on ESPN any more."];
  const mine = t.proposerTeamId === myTeamId;
  if (action === "withdraw" ? !mine : mine || t.partnerTeamId !== myTeamId) return [action === "withdraw" ? "Only the team that made an offer can withdraw it." : "Only the team an offer was made to can answer it."];
  if (action !== "accept") return [];
  if (pastDeadline(rules, now)) return ["The trade deadline has passed."];
  const me = teams.find((x) => x.id === myTeamId);
  if (!me) return ["Your team isn't in this league."];
  const gives = t.moves.filter((m) => m.fromTeamId === myTeamId).map((m) => m.playerId);
  const gets = t.moves.filter((m) => m.toTeamId === myTeamId).map((m) => m.playerId);
  const limit = rosterLimit(rules.starters, rules.benchSize);
  return countAfter(me, gives, gets) > limit ? [`Accepting leaves you over ${limit} players. Make room on ESPN first.`] : [];
}

/** What a re-read shows after acting: a proposal or accept is pending in its new state; a decline or withdraw is gone. */
export function tradeLanded(pending: readonly PendingTrade[], id: string | null, action: TradeAction | "propose"): boolean {
  if (!id) return false;
  const t = pending.find((x) => x.id === id);
  if (action === "propose") return t?.status === "proposed";
  if (action === "accept") return t?.status === "accepted";
  return !t;
}
