import { fnv1a } from "@/lib/data/fingerprint";
import type { LeagueSettings } from "@/lib/draft/types";

/**
 * Identifies what a plan was built for: the league settings that shape it and the player data.
 * A stored plan whose hash differs from the league's current one is stale. The model, provider and
 * prompt version are deliberately left out, so changing those doesn't flag every existing plan.
 */
export function planInputHash(settings: LeagueSettings, datasetId: string): string {
  const { teams, mySlot, scoring, valueThreshold, roster } = settings;
  const shape = JSON.stringify([teams, mySlot, scoring, valueThreshold, roster.map((slot) => [slot.key, [...slot.eligible].sort()]), datasetId]);
  return `v1-${fnv1a(shape)}`;
}

/** A deterministic simulator seed for a hash, so rebuilding the same plan input gives the same odds. */
export const planSeed = (hash: string): number => Number.parseInt(hash.slice(-8), 16) >>> 0;
