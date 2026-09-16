import { dataset, DATASET_ID } from "@/lib/data";
import { createLocalStores } from "./localStorage";
import type { Stores } from "./types";

export type { DraftStore, ImportStore, LeagueRecord, LeagueStore, PrefsStore, Stores, SyncControl } from "./types";
export { newId, nowIso } from "./ids";
export { MAX_LEAGUE_NAME } from "./records";

let stores: Stores | null = null;

/** The single place that chooses a persistence implementation. */
export function getStores(): Stores {
  stores ??= createLocalStores(undefined, { legacy: { season: dataset.season, datasetId: DATASET_ID } });
  return stores;
}
