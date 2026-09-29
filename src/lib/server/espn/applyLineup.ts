import "server-only";
import type { Db } from "@/lib/db/types";
import { checkMoves, landedMoves, toEspnItems, type RosterSnapshot } from "@/lib/season/apply";
import type { LineupMove } from "@/lib/season/lineup";
import { guardedWrite, type GuardedOutcome, type WriteDeps } from "./guardedWrite";

/**
 * Applies staged lineup moves to the user's ESPN team (12.1, docs/in-season.md §7), through the
 * guardrails in guardedWrite.ts: every move in one `ROSTER` transaction, checked against a fresh
 * read first and re-read after.
 */

export interface ApplyRequest {
  /** The NFL week the user staged for. */
  week: number;
  /** The roster as the user saw it when staging. */
  snapshot: RosterSnapshot;
  moves: LineupMove[];
}

type Landed = (LineupMove & { landed: boolean })[];

export type ApplyOutcome =
  /** ESPN took the moves; `moves` says which the re-read shows, and every one should have landed. */
  | { kind: "applied"; moves: Landed }
  /** The write went out but the re-read failed: nobody knows what landed. */
  | { kind: "unverified"; moves: LineupMove[]; detail: string }
  | Exclude<GuardedOutcome<Landed>, { kind: "applied" | "unverified" }>;

export type ApplyDeps = WriteDeps;

export async function applyLineup(db: Db, key: Buffer, userId: string, leagueId: string, request: ApplyRequest, deps: ApplyDeps = {}): Promise<ApplyOutcome> {
  const out = await guardedWrite<Landed>(
    db,
    key,
    userId,
    leagueId,
    {
      week: request.week,
      snapshot: request.snapshot,
      check: ({ league, roster }) => checkMoves(roster, request.moves, league.starters, league.benchSize),
      transaction: ({ roster }) => ({ type: "ROSTER", items: toEspnItems(roster, request.moves) }),
      landed: ({ roster }) => landedMoves(request.moves, roster),
      anyLanded: (moves) => moves.some((m) => m.landed),
    },
    deps,
  );
  if (out.kind === "applied") return { kind: "applied", moves: out.landed };
  if (out.kind === "unverified") return { kind: "unverified", moves: request.moves, detail: out.detail };
  return out;
}
