import { createLocalStores } from "./localStorage";
import type { Stores } from "./types";

export type { DraftStore, LeagueStore, PrefsStore, Stores } from "./types";
export { LOCAL_DRAFT_KEY } from "./types";

let stores: Stores | null = null;

/**
 * The single place that chooses a persistence implementation.
 * Epic 3 adds a server-backed implementation here, selected when cloud features are enabled.
 */
export function getStores(): Stores {
  stores ??= createLocalStores();
  return stores;
}
