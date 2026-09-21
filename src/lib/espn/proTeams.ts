import type { Position } from "@/lib/draft/types";

/**
 * ESPN's NFL team ids (`proTeamId`), verified against the D/ST entries of ESPN's player list:
 * each D/ST's player id is -16000 - proTeamId. 0 is a free agent; 31 and 32 are unused.
 */
export const PRO_TEAMS: Readonly<Record<number, string>> = {
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

/** Abbreviations that name the same team in different sources (the bundled sample says JAC and WAS). */
const TEAM_ALIASES: Readonly<Record<string, string>> = { JAC: "JAX", WAS: "WSH", LA: "LAR", OAK: "LV" };

/** One spelling per team, so abbreviations from ESPN and from the dataset compare equal. */
export const canonicalTeam = (abbrev: string): string => {
  const upper = abbrev.toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
};

/** ESPN's `defaultPositionId` for the positions the war room drafts. Others (IDP, coaches) map to nothing. */
export const ESPN_POSITIONS: Readonly<Record<number, Position>> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };

const DST_BASE = -16000;

/** The NFL team a D/ST player id stands for, or null if the id isn't a D/ST. */
export function dstTeam(espnPlayerId: number): string | null {
  const proTeamId = DST_BASE - espnPlayerId;
  return espnPlayerId < 0 ? (PRO_TEAMS[proTeamId] ?? null) : null;
}
