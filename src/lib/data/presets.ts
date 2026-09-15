import type { LeagueSettings, RosterSlot } from "@/lib/draft/types";
import { DEFAULT_VALUE_THRESHOLD } from "@/lib/draft/value";

/**
 * The prototype's 16-slot roster: QB, RB, RB, WR, WR, TE, FLEX (RB/WR/TE), D/ST, K, and 7 bench.
 * Returns fresh objects so callers can edit them.
 */
export function standardRoster(bench = 7): RosterSlot[] {
  return [
    { key: "QB", eligible: ["QB"] },
    { key: "RB", eligible: ["RB"] },
    { key: "RB", eligible: ["RB"] },
    { key: "WR", eligible: ["WR"] },
    { key: "WR", eligible: ["WR"] },
    { key: "TE", eligible: ["TE"] },
    { key: "FLEX", eligible: ["RB", "WR", "TE"] },
    { key: "DST", eligible: ["DST"] },
    { key: "K", eligible: ["K"] },
    ...Array.from({ length: bench }, (): RosterSlot => ({ key: "BN", eligible: [] })),
  ];
}

export interface LeaguePreset {
  id: string;
  label: string;
  league: LeagueSettings;
}

const preset = (teams: number): LeaguePreset => ({
  id: `${teams}-team-ppr`,
  label: `${teams} teams, full PPR`,
  league: { teams, mySlot: 1, scoring: "ppr", roster: standardRoster(), valueThreshold: DEFAULT_VALUE_THRESHOLD },
});

export const LEAGUE_PRESETS: readonly LeaguePreset[] = [preset(10), preset(12), preset(14)];

/** Used until the user sets up a league: the prototype's 12-team full-PPR league, slot 1. */
export const DEFAULT_LEAGUE: LeagueSettings = LEAGUE_PRESETS[1].league;
