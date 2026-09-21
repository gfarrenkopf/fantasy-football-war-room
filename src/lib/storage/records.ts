import { parseStoredLeague } from "@/lib/draft/league";
import { DRAFT_STATE_VERSION } from "@/lib/draft/state";
import type { DraftPick, DraftState, PickLabel } from "@/lib/draft/types";
import type { LeagueRecord } from "./types";

/**
 * Validators for persisted data. Shared by the browser stores and the server API, so anything
 * read back from localStorage or received over the wire goes through the same checks.
 */

const POSITIONS = new Set<string>(["QB", "RB", "WR", "TE", "K", "DST"]);

const isLabel = (l: unknown): l is PickLabel => {
  const { name, pos, team } = (l ?? {}) as Partial<PickLabel>;
  return typeof name === "string" && name.length <= 80 && (pos === null || POSITIONS.has(pos as string)) && (team === null || (typeof team === "string" && team.length <= 4));
};

const isPick = (p: unknown): p is DraftPick =>
  typeof p === "object" &&
  p !== null &&
  typeof (p as DraftPick).playerId === "string" &&
  typeof (p as DraftPick).mine === "boolean" &&
  ((p as DraftPick).label === undefined || isLabel((p as DraftPick).label));

/**
 * Validates and upgrades a stored draft. Add a case here when DRAFT_STATE_VERSION changes.
 * Anything unrecognizable is discarded rather than crashing the app.
 */
export function migrateDraftState(raw: unknown): DraftState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { version, picks } = raw as Partial<DraftState>;
  if (version !== DRAFT_STATE_VERSION || !Array.isArray(picks) || !picks.every(isPick)) return null;
  return { version, picks: picks.map(({ playerId, mine, label }) => (label ? { playerId, mine, label: { name: label.name, pos: label.pos, team: label.team } } : { playerId, mine })) };
}

export const MAX_LEAGUE_NAME = 60;
const MAX_ID = 64;

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** Validates a league record; returns null if any field is missing or malformed. Unknown fields are dropped. */
export function parseLeagueRecord(raw: unknown): LeagueRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<LeagueRecord>;
  const settings = parseStoredLeague(r.settings);
  if (
    !settings ||
    typeof r.id !== "string" ||
    !/^[\w-]+$/.test(r.id) ||
    r.id.length > MAX_ID ||
    typeof r.name !== "string" ||
    typeof r.season !== "number" ||
    !Number.isInteger(r.season) ||
    typeof r.datasetId !== "string" ||
    r.datasetId.length > MAX_ID ||
    !isIso(r.createdAt) ||
    !isIso(r.updatedAt)
  ) {
    return null;
  }
  const name = r.name.trim().slice(0, MAX_LEAGUE_NAME) || "Untitled league";
  return { id: r.id, name, season: r.season, datasetId: r.datasetId, settings, createdAt: r.createdAt, updatedAt: r.updatedAt };
}
