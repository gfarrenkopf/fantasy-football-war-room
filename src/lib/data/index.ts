import type { Dataset } from "@/lib/draft/types";
import sample from "./sample-2026.json";
import { validateDataset } from "./loadDataset";

export { DatasetError, indexPlayers, validateDataset } from "./loadDataset";
export { DEFAULT_LEAGUE, LEAGUE_PRESETS, standardRoster, type LeaguePreset } from "./presets";

/**
 * The player dataset the app runs on. To use your own data, replace sample-2026.json
 * (or change the import above) with a file of the same shape; see docs/self-hosting.md.
 */
export const dataset: Dataset = validateDataset(sample);
