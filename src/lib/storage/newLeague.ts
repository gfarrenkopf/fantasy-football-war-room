import { dataset, DATASET_ID } from "@/lib/data";
import type { LeagueSettings } from "@/lib/draft/types";
import { newId, nowIso } from "./ids";
import { MAX_LEAGUE_NAME } from "./records";
import type { LeagueRecord } from "./types";

/**
 * A brand-new saved league, stamped with the loaded dataset's season and fingerprint.
 *
 * Shared so the landing page can create a league without mounting <LeagueProvider>, and both
 * paths produce byte-identical records. The name is trimmed and clamped here, not by callers.
 */
export function newLeagueRecord(name: string, settings: LeagueSettings): LeagueRecord {
  const now = nowIso();
  return {
    id: newId(),
    name: name.trim().slice(0, MAX_LEAGUE_NAME),
    season: dataset.season,
    datasetId: DATASET_ID,
    settings,
    createdAt: now,
    updatedAt: now,
  };
}
