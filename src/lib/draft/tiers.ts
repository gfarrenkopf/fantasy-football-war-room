import { roundsOf } from "./snake";
import { LATE_POSITIONS, type LeagueSettings, type Player, type Position } from "./types";

/** Tiers 1-4 are real tiers; 5 is "Sleepers / Late" (and every K and D/ST). */
export type Tier = 1 | 2 | 3 | 4 | 5;
export const LATE_TIER: Tier = 5;
export const TIER_LABELS: Record<Tier, string> = {
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
  4: "Tier 4",
  5: "Sleepers / Late",
};

const TIER_COUNT = 4;
/** Share of the draft whose players get tiered: in a 16-round draft, anyone expected to go in the first 10 rounds. */
const TIERED_SHARE = 10 / 16;

/**
 * Fisher–Jenks natural breaks: splits sorted `values` into `k` contiguous classes minimizing
 * within-class variance. Returns the class (0..k-1) for each value. O(k·n²), fine for n ≲ 100.
 */
export function naturalBreaks(values: number[], k: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n <= k) return values.map((_, i) => i);

  // cost[i][j]: least total variance splitting values[0..i] into j+1 classes; start[i][j]: first index of the last class.
  const cost = Array.from({ length: n }, () => new Array<number>(k).fill(Infinity));
  const start = Array.from({ length: n }, () => new Array<number>(k).fill(0));
  const prefix = [0];
  const prefixSq = [0];
  for (const v of values) {
    prefix.push(prefix.at(-1)! + v);
    prefixSq.push(prefixSq.at(-1)! + v * v);
  }
  /** Sum of squared deviations of values[a..b], inclusive. */
  const ssd = (a: number, b: number) => {
    const w = b - a + 1;
    const s = prefix[b + 1] - prefix[a];
    return prefixSq[b + 1] - prefixSq[a] - (s * s) / w;
  };

  for (let i = 0; i < n; i++) cost[i][0] = ssd(0, i);
  for (let j = 1; j < k; j++) {
    for (let i = j; i < n; i++) {
      for (let s = j; s <= i; s++) {
        const c = cost[s - 1][j - 1] + ssd(s, i);
        if (c < cost[i][j]) {
          cost[i][j] = c;
          start[i][j] = s;
        }
      }
    }
  }

  const classes = new Array<number>(n);
  let end = n - 1;
  for (let j = k - 1; j >= 0; j--) {
    const s = j === 0 ? 0 : start[end][j];
    for (let i = s; i <= end; i++) classes[i] = j;
    end = s - 1;
  }
  return classes;
}

/**
 * Derives position tiers from natural gaps, replacing the prototype's hand-authored tiers.
 *
 * Per position, players expected to go in roughly the first 10/16 of the draft (by consensus
 * rank) are split into 4 tiers with natural breaks; everyone later is tier 5 "Sleepers / Late".
 * Breaks are computed on √rank so gaps near the top of the board count for more than the same
 * gap late. When every tiered player has projPoints, those are used instead.
 * K and D/ST are always tier 5.
 */
export function computeTiers(players: Player[], league: Pick<LeagueSettings, "teams" | "roster">): Map<string, Tier> {
  const cutoff = league.teams * Math.round(roundsOf(league) * TIERED_SHARE);
  const tiers = new Map<string, Tier>();

  const byPos = new Map<Position, Player[]>();
  for (const p of players) byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), p]);

  for (const [pos, list] of byPos) {
    if (LATE_POSITIONS.includes(pos)) {
      for (const p of list) tiers.set(p.id, LATE_TIER);
      continue;
    }
    const sorted = list.slice().sort((a, b) => a.consensusRank - b.consensusRank);
    const pool = sorted.filter((p) => p.consensusRank <= cutoff);
    const usePoints = pool.length > 0 && pool.every((p) => p.projPoints !== undefined);
    const ordered = usePoints ? pool.slice().sort((a, b) => b.projPoints! - a.projPoints!) : pool;
    const values = ordered.map((p) => (usePoints ? -p.projPoints! : Math.sqrt(p.consensusRank)));
    const classes = naturalBreaks(values, Math.min(TIER_COUNT, ordered.length));
    ordered.forEach((p, i) => tiers.set(p.id, (classes[i] + 1) as Tier));
    for (const p of sorted) if (!tiers.has(p.id)) tiers.set(p.id, LATE_TIER);
  }
  return tiers;
}
