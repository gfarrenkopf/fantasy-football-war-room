import "server-only";
import type { Db } from "@/lib/db/types";
import { acquireItems, acquireLanded, checkAcquire, rosterLimit, type Acquire } from "@/lib/season/acquire";
import type { RosterSnapshot } from "@/lib/season/apply";
import { guardedWrite, type GuardedOutcome, type WriteDeps } from "./guardedWrite";

/**
 * Adds a free agent to the user's ESPN team, with a drop to make room (13.3), through the guardrails
 * in guardedWrite.ts: one `FREEAGENT` transaction, checked against a fresh read first and re-read
 * after. Whether the player is still a free agent is ESPN's call: it refuses a player on waivers
 * (`TRAN_PLAYER_NOT_FREEAGENT`) and the whole transaction with him.
 */

export interface AcquireRequest extends Acquire {
  week: number;
  snapshot: RosterSnapshot;
}

export type AcquireLanded = { added: boolean; dropped: boolean };

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
        checkAcquire(
          roster,
          league.teams.filter((t) => t.id !== teamId),
          { add, drop },
          rosterLimit(league.starters, league.benchSize),
        ),
      transaction: ({ teamId }) => ({ type: "FREEAGENT", items: acquireItems(teamId, { add, drop }) }),
      landed: ({ roster }) => acquireLanded(roster, { add, drop }),
      anyLanded: (l) => l.added,
    },
    deps,
  );
}
