import "server-only";
import type { Db } from "@/lib/db/types";
import type { RosterSnapshot } from "@/lib/season/apply";
import type { Trade } from "@/lib/season/trade";
import { checkProposal, checkResponse, proposalItems, tradeLanded, type TradeAction } from "@/lib/season/tradeWrite";
import { guardedWrite, type GuardedOutcome, type WriteDeps } from "./guardedWrite";

/**
 * Trades on ESPN (13.5), through the guardrails in guardedWrite.ts: each is one transaction, checked
 * against a fresh read first and re-read after.
 *
 * - Propose: one `TRADE_PROPOSAL` with a `TRADE` item per player, and `DROP` items when the user
 *   would be over the roster limit. It has landed when the re-read shows it pending.
 * - Accept (`TRADE_ACCEPT`) and decline (`TRADE_DECLINE`) answer an offer by its id, with no items;
 *   withdraw is a `CANCEL` of the user's own proposal. An accepted trade stays pending through the
 *   league's review; a declined or withdrawn one leaves the list.
 *
 * Only the user's own team acts. A proposal names the partner's players, but nothing here writes
 * for the partner.
 */

export interface ProposeRequest {
  week: number;
  snapshot: RosterSnapshot;
  partner: number;
  gives: number[];
  gets: number[];
  /** The user's players to drop so the roster fits; empty when it already does. */
  drops: number[];
}

export function proposeTrade(db: Db, key: Buffer, userId: string, leagueId: string, request: ProposeRequest, deps: WriteDeps = {}, now = () => Date.now()): Promise<GuardedOutcome<{ pending: boolean }>> {
  const tradeOf = (teamId: number): Trade => ({ teamA: teamId, gives: request.gives, teamB: request.partner, gets: request.gets });
  return guardedWrite<{ pending: boolean }>(
    db,
    key,
    userId,
    leagueId,
    {
      week: request.week,
      snapshot: request.snapshot,
      check: ({ league, teamId }) => checkProposal(league.teams, league, tradeOf(teamId), request.drops, now()),
      transaction: ({ teamId }) => ({ type: "TRADE_PROPOSAL", items: proposalItems(tradeOf(teamId), request.drops) }),
      landed: ({ league }, sent) => ({ pending: tradeLanded(league.pendingTrades, sent?.id ?? null, "propose") }),
      anyLanded: (l) => l.pending,
    },
    deps,
  );
}

export interface RespondRequest {
  week: number;
  /** The user's roster when they chose; accepting checks it hasn't changed. Null for decline and withdraw. */
  snapshot: RosterSnapshot | null;
  tradeId: string;
  action: TradeAction;
}

export function respondToTrade(db: Db, key: Buffer, userId: string, leagueId: string, request: RespondRequest, deps: WriteDeps = {}, now = () => Date.now()): Promise<GuardedOutcome<{ done: boolean }>> {
  const { tradeId, action } = request;
  return guardedWrite<{ done: boolean }>(
    db,
    key,
    userId,
    leagueId,
    {
      week: request.week,
      snapshot: action === "accept" ? request.snapshot : null,
      check: ({ league, teamId }) => checkResponse(league.pendingTrades, league.teams, league, teamId, tradeId, action, now()),
      transaction: () =>
        action === "withdraw"
          ? { type: "TRADE_PROPOSAL", executionType: "CANCEL", relatedTransactionId: tradeId, items: [] }
          : { type: action === "accept" ? "TRADE_ACCEPT" : "TRADE_DECLINE", relatedTransactionId: tradeId },
      landed: ({ league }) => ({ done: tradeLanded(league.pendingTrades, tradeId, action) }),
      anyLanded: (l) => l.done,
    },
    deps,
  );
}
