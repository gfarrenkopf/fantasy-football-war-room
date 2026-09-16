import type { Dataset } from "@/lib/draft/types";

/** FNV-1a, 32-bit. Not cryptographic: it only has to notice that the player list changed. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Identifies a dataset by season and the set of player ids in it.
 *
 * Picks are stored as player ids, so what matters for a saved draft is whether those ids still
 * exist, not whether ADP moved. Swapping the sample data for a SportsDataIO run changes this;
 * a routine ADP refresh of the same players doesn't.
 */
export function datasetId(dataset: Pick<Dataset, "season" | "players">): string {
  const ids = dataset.players.map((p) => p.id).sort();
  return `${dataset.season}-${fnv1a(ids.join("\n"))}`;
}
