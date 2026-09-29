import "server-only";
import type { Db } from "@/lib/db/types";
import { rosterChanges, type RosterSnapshot } from "@/lib/season/apply";
import type { RosterEntry, SeasonLeague } from "@/lib/season/types";
import { loadLogin, markDisconnected, type EspnLogin } from "./logins";
import { loadSeason, type SeasonLoad, type SeasonLoader } from "./seasonData";
import { writeEspnTransaction, type EspnTransaction, type EspnWrite } from "./transactionWriter";

/**
 * The guardrails every write to the user's ESPN team goes through (12.1, Epic 13; docs/in-season.md
 * §7). Each write type supplies its checks, its transaction and how to tell what landed; this runs
 * them in order:
 *
 * - Re-read before writing, skipping the cache. Abort if ESPN moved on a week, if anything on the
 *   user's roster changed since they staged, or if the checks fail against the fresh read (a player
 *   now locked). ESPN has no dry run, so this is the only check of stale state.
 * - Write one transaction, which ESPN applies whole or not at all.
 * - Re-read after writing and report what landed, whatever ESPN answered: a timed-out write may
 *   still have landed.
 *
 * Only the user's own team, from their season link; the request never names it.
 */

/** A fresh read of the league, with the user's team. */
export interface Fresh {
  league: SeasonLeague;
  teamId: number;
  roster: RosterEntry[];
}

/** What a write type brings to the guardrails. */
export interface GuardedWrite<Landed> {
  /** The NFL week the user staged for. */
  week: number;
  /** The user's roster as they saw it when staging. */
  snapshot: RosterSnapshot;
  /** Why the write can't go against the fresh read, in words for the user; empty when it can. */
  check: (fresh: Fresh) => string[];
  transaction: (fresh: Fresh) => Pick<EspnTransaction, "type" | "items" | "executionType" | "relatedTransactionId" | "bidAmount">;
  /** What the re-read after writing shows landed. `sent` is ESPN's answer, when it took the write. */
  landed: (after: Fresh, sent: { id: string | null } | null) => Landed;
  /** Whether anything landed; a failed write with nothing landed is `write-failed`. */
  anyLanded: (landed: Landed) => boolean;
}

export type GuardedOutcome<Landed> =
  /** ESPN took the write; `landed` is what the re-read shows. */
  | { kind: "applied"; landed: Landed }
  /** The write went out but the re-read failed: nobody knows what landed. */
  | { kind: "unverified"; detail: string }
  /** ESPN changed since the user staged; nothing was sent. */
  | { kind: "changed"; changes: string[] }
  /** The checks fail against the fresh read; nothing was sent. */
  | { kind: "refused"; problems: string[] }
  /** ESPN refused the write; nothing landed. */
  | { kind: "espn-refused"; errors: { type: string; message: string }[]; detail: string }
  /** The write failed, and the re-read shows nothing landed. */
  | { kind: "write-failed"; detail: string }
  /** ESPN couldn't be read, or the login is gone. */
  | { kind: "problem"; problem: Exclude<SeasonLoad, { kind: "ok" }>["kind"] };

export interface WriteDeps {
  load?: SeasonLoader;
  login?: (db: Db, key: Buffer, userId: string) => Promise<EspnLogin | null>;
  write?: (login: EspnLogin, transaction: EspnTransaction) => Promise<EspnWrite>;
}

export async function guardedWrite<Landed>(db: Db, key: Buffer, userId: string, leagueId: string, w: GuardedWrite<Landed>, deps: WriteDeps = {}): Promise<GuardedOutcome<Landed>> {
  const { load = loadSeason, login: getLogin = (d, k, u) => loadLogin(d, k, u), write = writeEspnTransaction } = deps;

  const before = await load(db, key, userId, leagueId, { refresh: true });
  if (before.kind !== "ok") return { kind: "problem", problem: before.kind };
  // A cached read served because ESPN didn't answer isn't a re-read.
  if (before.stale) return { kind: "problem", problem: "unavailable" };
  const { league, espnTeamId: teamId } = before;
  if (league.currentWeek !== w.week) return { kind: "changed", changes: [`ESPN has moved on to week ${league.currentWeek}.`] };
  const roster = rosterOf(league, teamId);
  if (!roster) return { kind: "problem", problem: "not-linked" };
  const fresh: Fresh = { league, teamId, roster };

  const changes = rosterChanges(w.snapshot, roster);
  if (changes.length) return { kind: "changed", changes };
  const problems = w.check(fresh);
  if (problems.length) return { kind: "refused", problems };

  const credential = await getLogin(db, key, userId);
  if (!credential) return { kind: "problem", problem: "no-login" };
  const sent = await write(credential, { season: league.season, espnLeagueId: league.espnLeagueId, teamId, week: league.currentWeek, ...w.transaction(fresh) });
  if (!sent.ok && sent.reason === "auth") {
    await markDisconnected(db, userId);
    return { kind: "problem", problem: "disconnected" };
  }
  if (!sent.ok && sent.reason === "refused") return { kind: "espn-refused", errors: sent.errors, detail: sent.detail };

  const after = await load(db, key, userId, leagueId, { refresh: true });
  const rosterAfter = after.kind === "ok" && !after.stale ? rosterOf(after.league, teamId) : null;
  if (after.kind !== "ok" || !rosterAfter) {
    return { kind: "unverified", detail: `${sent.ok ? "ESPN took the write" : `the write failed (${sent.detail})`}, then the re-read failed (${after.kind === "ok" ? "stale" : after.kind})` };
  }
  const landed = w.landed({ league: after.league, teamId, roster: rosterAfter }, sent.ok ? { id: sent.id } : null);
  if (!sent.ok && !w.anyLanded(landed)) return { kind: "write-failed", detail: sent.detail };
  return { kind: "applied", landed };
}

const rosterOf = (league: SeasonLeague, teamId: number) => league.teams.find((t) => t.id === teamId)?.roster ?? null;
