import { isDraftAt } from "@/lib/draft/draftDay";
import { parseStoredLeague } from "@/lib/draft/league";
import { DRAFT_STATE_VERSION } from "@/lib/draft/state";
import type { DraftPick, DraftState, PickLabel } from "@/lib/draft/types";
import type { EspnConnection, LeagueRecord } from "./types";

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

/** An ESPN connection as the server writes it (src/app/api/espn/pair/route.ts checks the same ranges). */
export function parseEspnConnection(raw: unknown): EspnConnection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { espnLeagueId, espnTeamId, season } = raw as Partial<EspnConnection>;
  if (typeof espnLeagueId !== "string" || !/^\d{1,12}$/.test(espnLeagueId)) return null;
  if (!Number.isInteger(espnTeamId) || espnTeamId! < 1 || espnTeamId! > 64) return null;
  if (!Number.isInteger(season) || season! < 2000 || season! > 2100) return null;
  return { espnLeagueId, espnTeamId: espnTeamId!, season: season! };
}

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
  const record: LeagueRecord = { id: r.id, name, season: r.season, datasetId: r.datasetId, settings, createdAt: r.createdAt, updatedAt: r.updatedAt };
  // Kept only when present: a record without the key (an older client) must not clear the date.
  if ("draftAt" in r) record.draftAt = isDraftAt(r.draftAt) ? r.draftAt : null;
  // Kept so a device's cache knows the league is ESPN's. The server never takes it from a client.
  const espn = parseEspnConnection(r.espn);
  if (espn) record.espn = espn;
  return record;
}
