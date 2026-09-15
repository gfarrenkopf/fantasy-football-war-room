import { LATE_POSITIONS, type CpuStyle, type Player, type Position } from "../types";
import { scaleRound, type SimContext } from "./context";
import type { Rng } from "./rng";
import { STYLES } from "./styles";

export type Counts = Partial<Record<Position, number>>;

/** Score of a pick the team must not make (position at its cap). Lower scores are better. */
export const BLOCKED = 9e3;

const CANDIDATE_POOL = 40;
const SHORTLIST = 8;

/**
 * How attractive `p` is to a team with `counts` in `round`, for a CPU style. Lower is better.
 * Ported from the prototype's scoreCpu(); the fixed 12-team/16-round numbers now come from the
 * league's roster (see positionRules) and scale with draft length.
 */
export function scoreCpu(p: Player, counts: Counts, round: number, style: CpuStyle, fav: string | null, ctx: SimContext): number {
  const { rules, rounds } = ctx;
  let s = STYLES[style].base === "consensus" ? p.consensusRank : p.adp;
  const n = counts[p.pos] ?? 0;
  const r = rules[p.pos];

  if (n >= r.cap) return BLOCKED;
  switch (p.pos) {
    case "QB":
      if (n >= r.need) s += round < scaleRound(11, rounds) ? 200 : 40;
      if (n < r.need && round >= scaleRound(8, rounds)) s -= 12 * (round - scaleRound(8, rounds) + 1);
      break;
    case "TE":
      if (n >= r.need) s += round < scaleRound(11, rounds) ? 120 : 30;
      if (n < r.need && round >= scaleRound(8, rounds)) s -= 10 * (round - scaleRound(8, rounds) + 1);
      break;
    case "K":
    case "DST": {
      // Prototype (16 rounds): +400 before round 13, then -120 in 13, -240 in 14, -300 from 15.
      const lateStart = rounds - 3;
      if (round < lateStart) s += 400;
      else if (round >= rounds - 1) s -= 300;
      else s -= 120 * (round - lateStart + 1);
      break;
    }
    default:
      if (n >= r.soft) s += 200;
      if (n < r.need && round >= scaleRound(5, rounds)) s -= 8;
  }

  switch (style) {
    case "qbEarly":
      if (p.pos === "QB" && n === 0 && round >= 2 && round <= 5) s -= 30;
      break;
    case "zeroRB":
      if (p.pos === "RB" && round <= 5) s += 35;
      if ((p.pos === "WR" || p.pos === "TE") && round <= 5) s -= 6;
      break;
    case "rbHeavy":
      if (p.pos === "RB" && round <= 4) s -= 14;
      break;
    case "teReach":
      if (p.pos === "TE" && n === 0 && round >= 2 && round <= 4) s -= 25;
      break;
    case "homer":
      if (p.team === fav) s -= 22;
      break;
  }
  return s;
}

/**
 * Players a CPU considers: the top 40 available skill players by its base ranking, plus the best
 * K and D/ST once kickers are in play. Ported from the prototype's candidates().
 */
export function candidates(taken: Set<string>, base: "adp" | "consensus", round: number, ctx: SimContext): Player[] {
  const src = base === "consensus" ? ctx.byConsensus : ctx.byAdp;
  const out: Player[] = [];
  for (const p of src) {
    if (taken.has(p.id) || LATE_POSITIONS.includes(p.pos)) continue;
    out.push(p);
    if (out.length >= CANDIDATE_POOL) break;
  }
  if (round >= ctx.rounds - 3) {
    let k: Player | undefined;
    let d: Player | undefined;
    for (const p of src) {
      if (taken.has(p.id)) continue;
      if (!k && p.pos === "K") k = p;
      if (!d && p.pos === "DST") d = p;
      if (k && d) break;
    }
    if (k) out.push(k);
    if (d) out.push(d);
  }
  return out;
}

interface Scored {
  p: Player;
  s: number;
}

/**
 * Scores `pool` and drops blocked players. If everything in the pool is blocked, widens to every
 * available player, so a team only exceeds a cap when no legal player is left anywhere.
 */
function legalScored(pool: Player[], taken: Set<string>, score: (p: Player) => number, ctx: SimContext): Scored[] {
  const scored = (list: Player[]) => list.map((p) => ({ p, s: score(p) })).filter((x) => x.s < BLOCKED);
  let out = scored(pool);
  if (!out.length) out = scored(ctx.byAdp.filter((p) => !taken.has(p.id)));
  if (!out.length) out = ctx.byAdp.filter((p) => !taken.has(p.id)).map((p) => ({ p, s: BLOCKED }));
  return out.sort((a, b) => a.s - b.s);
}

/** A CPU team's pick: softmax-weighted random choice among its 8 best-scored candidates. */
export function cpuPick(taken: Set<string>, counts: Counts, round: number, style: CpuStyle, fav: string | null, rng: Rng, ctx: SimContext): Player | null {
  const def = STYLES[style];
  const pool = candidates(taken, def.base, round, ctx);
  const shortlist = legalScored(pool, taken, (p) => scoreCpu(p, counts, round, style, fav, ctx), ctx).slice(0, SHORTLIST);
  if (!shortlist.length) return null;
  const weights = shortlist.map((c) => Math.exp(-(c.s - shortlist[0].s) / def.temp));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < shortlist.length; i++) {
    r -= weights[i];
    if (r <= 0) return shortlist[i].p;
  }
  return shortlist[0].p;
}

/**
 * The best available players for a team with `counts`, adjusted for its needs: the prototype's
 * bestOnBoard(), which scores every available player as a "sharp" drafter would. Deterministic.
 */
export function bestOnBoard(taken: Set<string>, counts: Counts, round: number, ctx: SimContext, limit = 4, skip: Set<string> = new Set()): Player[] {
  const pool = ctx.byConsensus.filter((p) => !taken.has(p.id) && !skip.has(p.id));
  return pool
    .map((p) => ({ p, s: scoreCpu(p, counts, round, "sharp", null, ctx) }))
    .filter((x) => x.s < BLOCKED)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.p);
}
