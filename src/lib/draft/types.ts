/**
 * Core domain types for the draft engine.
 *
 * Everything under src/lib/draft is framework-free and pure: no React, no DOM,
 * no storage, no process.env. League size, draft slot, and roster shape are
 * always passed in, never hardcoded.
 */

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

export const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

/** Positions that are streamed / drafted late and excluded from Value/Reach and bye conflicts. */
export const LATE_POSITIONS: readonly Position[] = ["K", "DST"];

export type ScoringFormat = "ppr" | "half" | "std";

export interface Player {
  /** Stable slug, e.g. "josh-allen-qb-buf". Persisted in picks, so it must not change between dataset updates. */
  id: string;
  name: string;
  pos: Position;
  /** NFL team abbreviation, e.g. "BUF". */
  team: string;
  /** Bye week number for the player's team. */
  bye: number;
  /** Expert consensus overall rank (the prototype's ECR). Lower is better. */
  consensusRank: number;
  /** Platform average draft position (the prototype's ESPN rank). See Dataset.adpSource. */
  adp: number;
  /** Rank within position by consensusRank, 1-based. */
  posRank: number;
  /** Injury or situation flag shown on the card. */
  note?: string;
  /** Season projected fantasy points for the dataset's scoring format, when the data source provides it. */
  projPoints?: number;
}

export type RosterSlotKey = "QB" | "RB" | "WR" | "TE" | "FLEX" | "SUPERFLEX" | "K" | "DST" | "BN";

export interface RosterSlot {
  key: RosterSlotKey;
  /** Positions that may fill this slot. Empty for bench, which accepts anyone. */
  eligible: Position[];
}

export interface LeagueSettings {
  /** Number of teams in the league. */
  teams: number;
  /** The user's draft slot, 1..teams. */
  mySlot: number;
  scoring: ScoringFormat;
  /** Full roster in display order: starters first, then bench. Rounds = roster.length. */
  roster: RosterSlot[];
  /** |adp - consensusRank| at or above this many spots earns a Value or Reach tag. */
  valueThreshold: number;
}

export interface Pick {
  playerId: string;
  /** True if the user drafted this player. */
  mine: boolean;
}

/** Synced state of one draft. The pick number of picks[i] is i + 1. */
export interface DraftState {
  version: number;
  picks: Pick[];
}

export type CpuStyle =
  | "casual"
  | "sharp"
  | "qbEarly"
  | "zeroRB"
  | "rbHeavy"
  | "teReach"
  | "homer"
  | "chaos";

export type View = "focus" | "board";
export type CenterPanel = "plan" | "ba";
export type BestAvailableMode = "pos" | "all";

/** Per-device UI preferences. Kept separate from DraftState so cloud sync only carries picks. */
export interface UiPrefs {
  view: View;
  center: CenterPanel;
  baMode: BestAvailableMode;
  mockOn: boolean;
  /** CPU style for every other team, in draft-slot order skipping mySlot. Null = default room. */
  room: CpuStyle[] | null;
}

export interface Dataset {
  season: number;
  /** Human-readable label shown in the UI, e.g. "Sample data, late-Aug 2026 snapshot". */
  label: string;
  /** Name of the platform the adp field comes from, e.g. "ESPN". */
  adpSource: string;
  /** Scoring formats the rankings are valid for. */
  scoring: ScoringFormat[];
  /** Bye week per NFL team abbreviation. */
  byeWeeks: Record<string, number>;
  players: Player[];
}
