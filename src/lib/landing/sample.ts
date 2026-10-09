import raw from "@/lib/data/season-sample-2026.json";
import { validateSeasonSample } from "./seasonSample";

/**
 * The season landing page's sample week. Regenerate it each season with scripts/season-sample.mts
 * and point this import at the new file.
 */
export const seasonSample = validateSeasonSample(raw);
