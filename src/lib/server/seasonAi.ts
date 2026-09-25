import { and, eq } from "drizzle-orm";
import { seasonAiTrials, seasonAiUses, type SeasonAiUseKind } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { hasEntitlement, SEASON_PASS } from "./entitlements";

/**
 * Who gets in-season AI (Epic 11, 11.1): the AI lineup and the AI trade write-up. The optimal lineup
 * and the trade verdict are free and never come through here.
 *
 * - Every account gets TRIAL_WEEKS NFL weeks free, counted from the week of its first AI use that
 *   season (not from week 1, so late arrivals get a trial too). A week is ESPN's `scoringPeriodId`.
 * - After that, a league needs a season pass: the same pass as the draft plan, for that season.
 * - Each league gets one mid-week AI lineup and one Sunday AI lineup per week (SeasonAiUseKind).
 *   Trade write-ups are unlimited.
 */

export const TRIAL_WEEKS = 5;

export type SeasonAiAccess =
  /** Payments are off (AI_ALLOWLIST decided), the account is on AI_ALLOWLIST, or the league has a pass. */
  | { kind: "allowed"; via: "open" | "allowlist" | "pass" }
  /**
   * In the account's free trial. `trialWeek` is 1 to TRIAL_WEEKS. `started` is false until the first AI
   * use, which must call startTrial() so the count begins.
   */
  | { kind: "allowed"; via: "trial"; trialWeek: number; started: boolean }
  /** Payments are off and the account isn't on AI_ALLOWLIST. */
  | { kind: "not-allowed" }
  /** Payments are on, the trial is over, and the league has no pass for this season. */
  | { kind: "needs-purchase" };

/** Pure, so every combination is testable. Mirrors decidePlanAccess() for payments off and the allowlist. */
export async function decideSeasonAiAccess({
  paymentsEnabled,
  allowlist,
  email,
  week,
  trialStartWeek,
  isEntitled,
}: {
  paymentsEnabled: boolean;
  allowlist: readonly string[];
  email: string | null;
  /** This week's `scoringPeriodId`. */
  week: number;
  /** The account's first AI week this season, or null before its first use. */
  trialStartWeek: number | null;
  /** Looked up only when the trial doesn't decide the answer. */
  isEntitled: () => Promise<boolean>;
}): Promise<SeasonAiAccess> {
  const listed = email !== null && allowlist.includes(email.toLowerCase());
  if (!paymentsEnabled) return allowlist.length === 0 ? { kind: "allowed", via: "open" } : listed ? { kind: "allowed", via: "allowlist" } : { kind: "not-allowed" };
  if (listed) return { kind: "allowed", via: "allowlist" };
  // A pass is checked first, so a paid league never shows trial wording.
  if (await isEntitled()) return { kind: "allowed", via: "pass" };
  // A week before the recorded start can only be a league that runs behind; count it as the first.
  const trialWeek = trialStartWeek === null ? 1 : Math.max(1, week - trialStartWeek + 1);
  if (trialWeek <= TRIAL_WEEKS) return { kind: "allowed", via: "trial", trialWeek, started: trialStartWeek !== null };
  return { kind: "needs-purchase" };
}

/** In-season AI access for one of the user's leagues, looked up from the database. */
export async function seasonAiAccess(
  db: Db,
  {
    paymentsEnabled,
    allowlist,
    userId,
    email,
    leagueId,
    leagueSeason,
    season,
    week,
  }: {
    paymentsEnabled: boolean;
    allowlist: readonly string[];
    userId: string;
    email: string | null;
    leagueId: string;
    /** The war room league's season. A pass counts only for the season it was bought for. */
    leagueSeason: number;
    /** The ESPN season being played. */
    season: number;
    week: number;
  },
): Promise<SeasonAiAccess> {
  return decideSeasonAiAccess({
    paymentsEnabled,
    allowlist,
    email,
    week,
    trialStartWeek: await trialStartWeek(db, userId, season),
    isEntitled: async () => leagueSeason === season && (await hasEntitlement(db, leagueId, SEASON_PASS)),
  });
}

/** The account's first in-season AI week this season, or null if it hasn't used any. */
export async function trialStartWeek(db: Db, userId: string, season: number): Promise<number | null> {
  const [row] = await db
    .select({ firstWeek: seasonAiTrials.firstWeek })
    .from(seasonAiTrials)
    .where(and(eq(seasonAiTrials.userId, userId), eq(seasonAiTrials.season, season)));
  return row?.firstWeek ?? null;
}

/** Starts the account's trial at `week`, unless it already started. Returns the week it started. */
export async function startTrial(db: Db, userId: string, season: number, week: number): Promise<number> {
  await db.insert(seasonAiTrials).values({ userId, season, firstWeek: week }).onConflictDoNothing();
  return (await trialStartWeek(db, userId, season)) ?? week;
}

export interface SeasonAiUse {
  leagueId: string;
  season: number;
  week: number;
  kind: SeasonAiUseKind;
}

/** Takes a league's weekly allowance of `kind`. False when this week's is already used. */
export async function claimSeasonAiUse(db: Db, use: SeasonAiUse): Promise<boolean> {
  const inserted = await db.insert(seasonAiUses).values(use).onConflictDoNothing().returning({ kind: seasonAiUses.kind });
  return inserted.length > 0;
}

/** Gives an allowance back, e.g. when the AI call failed and nothing was delivered. */
export async function releaseSeasonAiUse(db: Db, use: SeasonAiUse): Promise<void> {
  await db
    .delete(seasonAiUses)
    .where(and(eq(seasonAiUses.leagueId, use.leagueId), eq(seasonAiUses.season, use.season), eq(seasonAiUses.week, use.week), eq(seasonAiUses.kind, use.kind)));
}

/** The allowances a league has used this week. A new `scoringPeriodId` starts with none. */
export async function usedSeasonAi(db: Db, leagueId: string, season: number, week: number): Promise<SeasonAiUseKind[]> {
  const rows = await db
    .select({ kind: seasonAiUses.kind })
    .from(seasonAiUses)
    .where(and(eq(seasonAiUses.leagueId, leagueId), eq(seasonAiUses.season, season), eq(seasonAiUses.week, week)));
  return rows.map((r) => r.kind).sort();
}
