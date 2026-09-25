import "server-only";
import type { Db } from "@/lib/db/types";
import { checkMoves, landedMoves, rosterChanges, toEspnItems, type RosterSnapshot } from "@/lib/season/apply";
import type { LineupMove } from "@/lib/season/lineup";
import type { SeasonLeague } from "@/lib/season/types";
import { writeEspnLineup, type EspnWrite, type EspnLineupWrite } from "./lineupWriter";
import { loadLogin, markDisconnected, type EspnLogin } from "./logins";
import { loadSeason, type SeasonLoad, type SeasonLoader } from "./seasonData";

/**
 * Applies staged lineup moves to the user's ESPN team (12.1, docs/in-season.md §7). The guardrails:
 *
 * - Re-read before writing, skipping the cache. Abort if ESPN moved on a week, if anything on the
 *   roster changed since the user staged, or if the moves fail the local checks (a player now locked
 *   among them). ESPN has no dry run, so this is the only check of stale state.
 * - Write every move in one transaction, which ESPN applies whole or not at all.
 * - Re-read after writing and report which moves landed, whatever ESPN answered: a timed-out write
 *   may still have landed.
 *
 * Only the user's own team, from their season link; the request never names a team.
 */

export interface ApplyRequest {
  /** The NFL week the user staged for. */
  week: number;
  /** The roster as the user saw it when staging. */
  snapshot: RosterSnapshot;
  moves: LineupMove[];
}

export type ApplyOutcome =
  /** ESPN took the moves; `moves` says which the re-read shows, and every one should have landed. */
  | { kind: "applied"; moves: (LineupMove & { landed: boolean })[] }
  /** The write went out but the re-read failed: nobody knows what landed. */
  | { kind: "unverified"; moves: LineupMove[]; detail: string }
  /** ESPN changed since the user staged; nothing was sent. */
  | { kind: "changed"; changes: string[] }
  /** The moves fail the local checks against the fresh roster; nothing was sent. */
  | { kind: "refused"; problems: string[] }
  /** ESPN refused the moves; nothing landed. */
  | { kind: "espn-refused"; errors: { type: string; message: string }[]; detail: string }
  /** The write failed, and the re-read shows nothing landed. */
  | { kind: "write-failed"; detail: string }
  /** ESPN couldn't be read, or the login is gone. */
  | { kind: "problem"; problem: Exclude<SeasonLoad, { kind: "ok" }>["kind"] };

export interface ApplyDeps {
  load?: SeasonLoader;
  login?: (db: Db, key: Buffer, userId: string) => Promise<EspnLogin | null>;
  write?: (login: EspnLogin, write: EspnLineupWrite) => Promise<EspnWrite>;
}

export async function applyLineup(db: Db, key: Buffer, userId: string, leagueId: string, request: ApplyRequest, deps: ApplyDeps = {}): Promise<ApplyOutcome> {
  const { load = loadSeason, login: getLogin = (d, k, u) => loadLogin(d, k, u), write = writeEspnLineup } = deps;

  const before = await load(db, key, userId, leagueId, { refresh: true });
  if (before.kind !== "ok") return { kind: "problem", problem: before.kind };
  // A cached read served because ESPN didn't answer isn't a re-read.
  if (before.stale) return { kind: "problem", problem: "unavailable" };
  const { league, espnTeamId } = before;
  if (league.currentWeek !== request.week) return { kind: "changed", changes: [`ESPN has moved on to week ${league.currentWeek}.`] };
  const roster = rosterOf(league, espnTeamId);
  if (!roster) return { kind: "problem", problem: "not-linked" };

  const changes = rosterChanges(request.snapshot, roster);
  if (changes.length) return { kind: "changed", changes };
  const problems = checkMoves(roster, request.moves, league.starters, league.benchSize);
  if (problems.length) return { kind: "refused", problems };

  const credential = await getLogin(db, key, userId);
  if (!credential) return { kind: "problem", problem: "no-login" };
  const sent = await write(credential, {
    season: league.season,
    espnLeagueId: league.espnLeagueId,
    teamId: espnTeamId,
    week: league.currentWeek,
    items: toEspnItems(roster, request.moves),
  });
  if (!sent.ok && sent.reason === "auth") {
    await markDisconnected(db, userId);
    return { kind: "problem", problem: "disconnected" };
  }
  if (!sent.ok && sent.reason === "refused") return { kind: "espn-refused", errors: sent.errors, detail: sent.detail };

  const after = await load(db, key, userId, leagueId, { refresh: true });
  const rosterAfter = after.kind === "ok" && !after.stale ? rosterOf(after.league, espnTeamId) : null;
  if (!rosterAfter) {
    const detail = `${sent.ok ? "ESPN took the write" : `the write failed (${sent.detail})`}, then the re-read failed (${after.kind === "ok" ? "stale" : after.kind})`;
    return { kind: "unverified", moves: request.moves, detail };
  }
  const moves = landedMoves(request.moves, rosterAfter);
  if (!sent.ok && !moves.some((m) => m.landed)) return { kind: "write-failed", detail: sent.detail };
  return { kind: "applied", moves };
}

const rosterOf = (league: SeasonLeague, teamId: number) => league.teams.find((t) => t.id === teamId)?.roster ?? null;
