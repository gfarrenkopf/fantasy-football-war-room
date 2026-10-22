import "server-only";
import type { Db } from "@/lib/db/types";
import { acquireItems, acquireLanded, checkAcquire, checkCancel, checkClaim, checkDrop, claimPending, dropItems, dropLanded, rosterLimit, type Acquire } from "@/lib/season/acquire";
import type { RosterSnapshot } from "@/lib/season/apply";
import { guardedWrite, type GuardedOutcome, type WriteDeps } from "./guardedWrite";

/**
 * Adding players from ESPN's pool to the user's team (Epic 13), through the guardrails in
 * guardedWrite.ts: each is one transaction, checked against a fresh read first and re-read after.
 *
 * - A free agent is added at once, with a drop to make room (13.3). Whether the player is still a
 *   free agent is ESPN's call: it refuses one on waivers (`TRAN_PLAYER_NOT_FREEAGENT`), and the
 *   whole transaction with him.
 * - A player on waivers is claimed (13.4): the claim waits for waivers to process, and its drop only
 *   happens if it succeeds. It has landed when the re-read shows it pending. A pending claim can be
 *   cancelled. Leagues that bid FAAB aren't supported yet: their claims happen on ESPN.
 * - A player can be dropped with nobody added (APE-425): a `ROSTER` transaction with only the
 *   `DROP` item, since ESPN wants exactly one `ADD` in a `FREEAGENT`. He goes on waivers.
 */

export interface AcquireRequest extends Acquire {
  week: number;
  snapshot: RosterSnapshot;
}

export type AcquireLanded = { added: boolean; dropped: boolean };

const others = (league: { teams: { id: number; name: string; roster: { playerId: number }[] }[] }, teamId: number) => league.teams.filter((t) => t.id !== teamId);

export function addFreeAgent(db: Db, key: Buffer, userId: string, leagueId: string, request: AcquireRequest, deps: WriteDeps = {}): Promise<GuardedOutcome<AcquireLanded>> {
  const { add, drop } = request;
  return guardedWrite<AcquireLanded>(
    db,
    key,
    userId,
    leagueId,
    {
      week: request.week,
      snapshot: request.snapshot,
      check: ({ league, teamId, roster }) =>
        checkAcquire(roster, others(league, teamId), { add, drop }, rosterLimit(league.starters, league.benchSize)),
      transaction: ({ teamId }) => ({ type: "FREEAGENT", items: acquireItems(teamId, { add, drop }) }),
      landed: ({ roster }) => acquireLanded(roster, { add, drop }),
      anyLanded: (l) => l.added,
    },
    deps,
  );
}

export interface DropRequest {
  week: number;
  snapshot: RosterSnapshot;
  drop: number;
}

export function dropPlayer(db: Db, key: Buffer, userId: string, leagueId: string, { week, snapshot, drop }: DropRequest, deps: WriteDeps = {}): Promise<GuardedOutcome<{ dropped: boolean }>> {
  return guardedWrite<{ dropped: boolean }>(
    db,
    key,
    userId,
    leagueId,
    {
      week,
      snapshot,
      check: ({ roster }) => checkDrop(roster, drop),
      transaction: ({ teamId }) => ({ type: "ROSTER", items: dropItems(teamId, drop) }),
      landed: ({ roster }) => dropLanded(roster, drop),
      anyLanded: (l) => l.dropped,
    },
    deps,
  );
}

export function claimWaiver(db: Db, key: Buffer, userId: string, leagueId: string, request: AcquireRequest, deps: WriteDeps = {}): Promise<GuardedOutcome<{ pending: boolean }>> {
  const { add, drop } = request;
  return guardedWrite<{ pending: boolean }>(
    db,
    key,
    userId,
    leagueId,
    {
      week: request.week,
      snapshot: request.snapshot,
      check: ({ league, teamId, roster }) => checkClaim(league.waivers.budget, roster, others(league, teamId), { add, drop }, rosterLimit(league.starters, league.benchSize)),
      transaction: ({ teamId }) => ({ type: "WAIVER", items: acquireItems(teamId, { add, drop }), bidAmount: null }),
      landed: ({ league, teamId }, sent) => ({ pending: claimPending(league.pendingClaims, teamId, { id: sent?.id ?? null, add }) }),
      anyLanded: (l) => l.pending,
    },
    deps,
  );
}

export function cancelClaim(db: Db, key: Buffer, userId: string, leagueId: string, { week, claimId }: { week: number; claimId: string }, deps: WriteDeps = {}): Promise<GuardedOutcome<{ cancelled: boolean }>> {
  return guardedWrite<{ cancelled: boolean }>(
    db,
    key,
    userId,
    leagueId,
    {
      week,
      snapshot: null,
      check: ({ league, teamId }) => checkCancel(league.pendingClaims.filter((c) => c.teamId === teamId), claimId),
      transaction: () => ({ type: "WAIVER", executionType: "CANCEL", relatedTransactionId: claimId, items: [] }),
      landed: ({ league }) => ({ cancelled: !league.pendingClaims.some((c) => c.id === claimId) }),
      anyLanded: (l) => l.cancelled,
    },
    deps,
  );
}
