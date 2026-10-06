import { and, eq, sql } from "drizzle-orm";
import { seasonLineupMoves } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import type { LineupSlot } from "@/lib/season/types";
import type { WarRoomMove } from "@/lib/season/view";

/**
 * The lineup moves War Room got the user (APE-256). Callers scope by league, which is the user's own:
 * the apply route checks ownership before writing, and the season page reads only a league it loaded.
 */

export interface MadeMove {
  playerId: number;
  from: LineupSlot;
  to: LineupSlot;
  gain: number;
}

/** Records moves that landed. Making a player's move again in the same week replaces it. */
export async function recordLineupMoves(db: Db, leagueId: string, season: number, week: number, moves: readonly MadeMove[], now = new Date()): Promise<void> {
  if (!moves.length) return;
  await db
    .insert(seasonLineupMoves)
    .values(moves.map((m) => ({ leagueId, season, week, playerId: m.playerId, fromSlot: m.from, toSlot: m.to, gain: m.gain, appliedAt: now })))
    .onConflictDoUpdate({
      target: [seasonLineupMoves.leagueId, seasonLineupMoves.season, seasonLineupMoves.week, seasonLineupMoves.playerId],
      set: { fromSlot: sql`excluded.from_slot`, toSlot: sql`excluded.to_slot`, gain: sql`excluded.gain`, appliedAt: now },
    });
}

/** The moves made for one week, oldest first. */
export async function listLineupMoves(db: Db, leagueId: string, season: number, week: number): Promise<WarRoomMove[]> {
  const rows = await db
    .select()
    .from(seasonLineupMoves)
    .where(and(eq(seasonLineupMoves.leagueId, leagueId), eq(seasonLineupMoves.season, season), eq(seasonLineupMoves.week, week)))
    .orderBy(seasonLineupMoves.appliedAt, seasonLineupMoves.playerId);
  return rows.map((r) => ({ playerId: r.playerId, slot: r.toSlot as LineupSlot, gain: r.gain }));
}
