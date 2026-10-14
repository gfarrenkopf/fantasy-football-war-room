import "server-only";
import type { Db } from "@/lib/db/types";
import { madeMoves, type RosterSnapshot, type SuggestedMove } from "@/lib/season/apply";
import type { LineupSlot } from "@/lib/season/types";
import { recordLineupMoves } from "../lineupMoves";
import { applyLineup, type ApplyDeps, type ApplyOutcome, type ApplyRequest } from "./applyLineup";

/**
 * Setting the user's lineup on ESPN, as both the web's apply route and the app's lineup route do it
 * (12.1, APE-381), once the consent gate has passed: the guarded write, then keeping the moves War
 * Room suggested that landed (APE-256). Moves that didn't land raise an alert.
 */

export interface LineupWrite extends ApplyRequest {
  /** The season the week is in; War Room's moves aren't kept without it. */
  season: number | null;
  /** The moves War Room suggested, with their gains. */
  suggested: SuggestedMove[];
}

export interface WriteLog {
  /** Logs [server-error] for something the user's team needs checked. */
  alert: (message: string) => void;
  /** Logs [server-error] for a failure that mustn't fail the write. */
  failed: (err: unknown) => void;
}

export async function writeLineup(db: Db, key: Buffer, userId: string, leagueId: string, request: LineupWrite, log: WriteLog, deps?: ApplyDeps): Promise<ApplyOutcome> {
  const out = await applyLineup(db, key, userId, leagueId, request, deps);
  if (out.kind !== "applied") return out;
  const made = madeMoves(out.moves, request.suggested);
  // The lineup is set either way: failing to remember War Room's part mustn't fail the apply.
  if (made.length && request.season !== null) await recordLineupMoves(db, leagueId, request.season, request.week, made).catch(log.failed);
  const missed = out.moves.filter((m) => !m.landed);
  if (missed.length) log.alert(`ESPN lineup apply: ${missed.length} of ${out.moves.length} moves didn't land (${missed.map((m) => `${m.playerId} ${m.from}->${m.to}`).join(", ")})`);
  return out;
}

const SLOTS = new Set<LineupSlot>(["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "DST", "K", "BN", "IR"]);
export const isSlot = (v: unknown): v is LineupSlot => typeof v === "string" && SLOTS.has(v as LineupSlot);
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The roster the user staged against, from a request body, or null when it isn't one. */
export function readSnapshot(v: unknown): RosterSnapshot | null {
  if (!Array.isArray(v) || v.length > 100) return null;
  const snapshot = v.flatMap((p) => (isObject(p) && Number.isInteger(p.playerId) && isSlot(p.slot) ? [{ playerId: p.playerId as number, slot: p.slot }] : []));
  return snapshot.length === v.length ? snapshot : null;
}
