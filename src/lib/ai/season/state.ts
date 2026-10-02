import type { AiLineup } from "./lineup";
import type { AiTradeIdeas } from "./tradeIdeas";

/**
 * In-season AI as the season page sees it (11.2), handed from the server as plain JSON. Types only,
 * so the client can import them.
 */

/** The weekly AI lineups (11.1): the mid-week one, and the Sunday one (11.3). */
export type SeasonAiLineupKind = "lineup-midweek" | "lineup-sunday";

/** A per-league-week in-season AI allowance: each AI lineup, and the week's trade ideas (APE-222). */
export type SeasonAiUseKind = SeasonAiLineupKind | "trade-ideas";

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
  lineups: Partial<Record<SeasonAiLineupKind, StoredAiOutput<AiLineup>>>;
  /** This week's trade ideas, once found (APE-222). */
  tradeIdeas: StoredAiOutput<AiTradeIdeas> | null;
  /** Whether this week's mid-week lineup allowance is gone (used, with or without a stored lineup). */
  midweekUsed: boolean;
}

/** The body of a 402 from an in-season AI route. */
export const SEASON_NEEDS_PURCHASE = { needsPurchase: true } as const;
