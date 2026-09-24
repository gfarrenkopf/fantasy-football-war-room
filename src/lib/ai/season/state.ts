import type { AiLineup } from "./lineup";

/**
 * In-season AI as the season page sees it (11.2), handed from the server as plain JSON. Types only,
 * so the client can import them.
 */

/** A per-league-week in-season AI allowance (11.1): the mid-week lineup, and the Sunday one (11.3). */
export type SeasonAiUseKind = "lineup-midweek" | "lineup-sunday";

export type SeasonAiAccessView =
  | { kind: "allowed" }
  /** In the account's free trial: week `trialWeek` of `trialWeeks`. */
  | { kind: "trial"; trialWeek: number; trialWeeks: number }
  /** The trial is over and the league has no season pass: AI actions show the checkout. */
  | { kind: "needs-purchase" };

export interface StoredAiOutput<T> {
  output: T;
  createdAt: string;
}

export interface SeasonAiState {
  access: SeasonAiAccessView;
  /** This week's AI lineups, by kind. */
  lineups: Partial<Record<SeasonAiUseKind, StoredAiOutput<AiLineup>>>;
  /** Whether this week's mid-week lineup allowance is gone (used, with or without a stored lineup). */
  midweekUsed: boolean;
}

/** The body of a 402 from an in-season AI route. */
export const SEASON_NEEDS_PURCHASE = { needsPurchase: true } as const;
