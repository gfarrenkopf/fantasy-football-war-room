import "server-only";
import type { Db } from "@/lib/db/types";
import type { FillPlan } from "@/lib/season/holeFill";
import { writeAcquire, type AcquireResult } from "./acquireWrite";
import type { ApplyOutcome } from "./applyLineup";
import type { GuardedOutcome } from "./guardedWrite";
import { writeLineup, type WriteLog } from "./lineupWrite";

/**
 * Filling a hole on ESPN (APE-404), as the app's fill route does it once the consent gate has
 * passed: the plan's steps in order (IR, add, start), each a guarded write of its own checked against
 * the roster the step before left. A step that doesn't land stops the fill there.
 */

export type FillStepRun = { step: "ir" | "start"; out: ApplyOutcome } | { step: "add"; out: GuardedOutcome<AcquireResult> };

/** Whether ESPN shows the step: every lineup move landed, or the player was added. */
export function stepLanded(run: FillStepRun): boolean {
  if (run.out.kind !== "applied") return false;
  return run.step === "add" ? "added" in run.out.landed && run.out.landed.added : (run.out as Extract<ApplyOutcome, { kind: "applied" }>).moves.every((m) => m.landed);
}

/** Runs the plan's steps until one doesn't land; returns each step run, in order. */
export async function writeFill(db: Db, key: Buffer, userId: string, leagueId: string, { week, season, plan }: { week: number; season: number; plan: FillPlan }, log: WriteLog): Promise<FillStepRun[]> {
  const ran: FillStepRun[] = [];
  const go = (run: FillStepRun) => {
    ran.push(run);
    return stepLanded(run);
  };
  if (plan.ir && !go({ step: "ir", out: await writeLineup(db, key, userId, leagueId, { week, season, snapshot: plan.ir.snapshot, moves: [plan.ir.move], suggested: [] }, log) })) return ran;
  const { out } = await writeAcquire(db, key, userId, leagueId, { kind: "add", week, snapshot: plan.add.snapshot, add: plan.add.add, drop: plan.add.drop }, log.alert);
  if (!go({ step: "add", out })) return ran;
  go({ step: "start", out: await writeLineup(db, key, userId, leagueId, { week, season, snapshot: plan.start.snapshot, moves: plan.start.moves, suggested: plan.start.suggested }, log) });
  return ran;
}
