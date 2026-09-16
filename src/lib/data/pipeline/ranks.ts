import { LATE_POSITIONS, type Position } from "@/lib/draft/types";

/**
 * Derives `consensusRank` and `posRank` from projected points (2.1b).
 *
 * ## Why not raw projected points
 *
 * `Dataset` needs a ranking independent of ADP, because `valueTag()` is
 * `adp - consensusRank` — if the two columns share a source, every player is
 * tagged "even" and Value/Reach silently dies. SportsDataIO has no expert
 * consensus rank, so we build one from projections.
 *
 * Ranking on raw season points does not work. Quarterbacks score far more raw
 * points than anyone else, so a raw ranking puts ~21 QBs in the first 36 picks
 * (measured against the 2026 data) and would tag every QB a huge Value and every
 * RB a Reach. That is worse than having no tag at all.
 *
 * ## What we do instead
 *
 * Value over replacement: a player is worth what he scores above the last
 * startable player at his own position. That is what makes positions comparable,
 * and it is the thing expert consensus rank approximates. On the 2026 data this
 * produces a first-36 makeup of RB 18 / WR 15 / TE 2 / QB 1, against the actual
 * ADP's RB 17 / WR 16 / TE 2 / QB 1 — while staying computed from projections,
 * not from ADP.
 *
 * ## The canonical-league caveat
 *
 * Replacement level depends on how many starters a league has, so strictly
 * speaking this is league-dependent, the same trap that rescoped 2.3. We pin a
 * canonical 12-team league here and document it, because `consensusRank` is a
 * field of the shipped dataset and must be a single number. Real ECR makes the
 * same generic-12-team assumption. Tiering and Value/Reach still recompute per
 * the user's actual league at runtime.
 */

/**
 * Startable players per position in the canonical 12-team league: 12 teams times
 * the standard roster's starters, with FLEX spread across RB and WR. Changing
 * these shifts every consensusRank, so treat them as a published constant.
 */
export const REPLACEMENT_STARTERS: Readonly<Record<Position, number>> = Object.freeze({
  QB: 12, // 1 per team
  RB: 30, // 2 per team + half the FLEX
  WR: 36, // 2 per team + half the FLEX
  TE: 12, // 1 per team
  K: 12,
  DST: 12,
});

export interface Rankable {
  id: string;
  pos: Position;
  /** Season projected points. Undefined when the source has no projection for him. */
  projPoints?: number;
  /** Platform ADP, used only to order players who have no projection at all. */
  adp: number;
}

/** Keyed by player id in the returned map, so the id isn't repeated here. */
export interface Ranked {
  consensusRank: number;
  posRank: number;
}

/** The replacement-level point total for each position present in `players`. */
export function replacementLevels(players: Rankable[]): Map<Position, number> {
  const levels = new Map<Position, number>();
  const byPos = new Map<Position, number[]>();
  for (const p of players) {
    if (p.projPoints === undefined) continue;
    byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), p.projPoints]);
  }
  for (const [pos, points] of byPos) {
    const sorted = points.slice().sort((a, b) => b - a);
    const n = Math.min(REPLACEMENT_STARTERS[pos], sorted.length);
    levels.set(pos, n > 0 ? sorted[n - 1] : 0);
  }
  return levels;
}

/**
 * Ranks every player, returning dense 1..n overall ranks and 1..n within each position.
 *
 * Players with a projection are ordered by value over replacement. Players without one
 * (deep bench, and on the current data every D/ST, since the projections endpoint carries
 * none) sort after all projected players, ordered by ADP. An undrafted player with neither
 * signal sorts last. Ties break on `id` so two runs on identical input are byte-identical —
 * saved drafts are keyed by player id, and an unstable ranking would reshuffle the board
 * between refreshes for no reason.
 */
export function rankPlayers(players: Rankable[]): Map<string, Ranked> {
  const levels = replacementLevels(players);

  const scored = players.map((p) => ({
    id: p.id,
    pos: p.pos,
    hasProj: p.projPoints !== undefined,
    vorp: p.projPoints === undefined ? 0 : p.projPoints - (levels.get(p.pos) ?? 0),
    // Undrafted players report 0; push them behind everyone with a real ADP.
    adp: p.adp > 0 ? p.adp : Number.MAX_SAFE_INTEGER,
  }));

  scored.sort((a, b) => {
    if (a.hasProj !== b.hasProj) return a.hasProj ? -1 : 1;
    if (a.hasProj && b.hasProj && a.vorp !== b.vorp) return b.vorp - a.vorp;
    if (a.adp !== b.adp) return a.adp - b.adp;
    return a.id.localeCompare(b.id);
  });

  const ranked = new Map<string, Ranked>();
  const posCounts = new Map<Position, number>();
  scored.forEach((p, i) => {
    const posRank = (posCounts.get(p.pos) ?? 0) + 1;
    posCounts.set(p.pos, posRank);
    ranked.set(p.id, { consensusRank: i + 1, posRank });
  });
  return ranked;
}

/**
 * True when a ranking has collapsed into the ADP it is supposed to be independent of.
 * 2.3 uses this as a hard gate; it is the specific regression this module exists to prevent.
 */
export function ranksMatchAdp(players: { consensusRank: number; adp: number; pos: Position }[]): boolean {
  const comparable = players.filter((p) => !LATE_POSITIONS.includes(p.pos) && p.adp > 0);
  if (!comparable.length) return false;
  const identical = comparable.filter((p) => p.consensusRank === Math.round(p.adp)).length;
  return identical / comparable.length > 0.9;
}
