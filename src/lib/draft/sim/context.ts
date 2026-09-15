import { roundsOf, totalPicks } from "../snake";
import { POSITIONS, type LeagueSettings, type Player, type Position } from "../types";

/** Per-position roster limits the CPU drafts against, derived from the league's roster. */
export interface PositionRules {
  /** Starters the team wants at this position (dedicated slots, plus SUPERFLEX for QB). */
  need: number;
  /** Past this count a pick is penalized (RB/WR only; QB/TE/K/DST are penalized from `need`). */
  soft: number;
  /** Hard maximum; the simulator never drafts past it while any other player is available. */
  cap: number;
}

/** Everything the simulator needs about a league and dataset, precomputed once. */
export interface SimContext {
  league: LeagueSettings;
  players: Player[];
  byId: Map<string, Player>;
  byAdp: Player[];
  byConsensus: Player[];
  rules: Record<Position, PositionRules>;
  rounds: number;
  total: number;
  /** Teams present in the dataset, for homers. */
  teams: string[];
}

/** Scales one of the prototype's 16-round thresholds to this draft's length. */
export const scaleRound = (round16: number, rounds: number) => Math.max(1, Math.round((round16 * rounds) / 16));

export function positionRules(league: Pick<LeagueSettings, "roster">): Record<Position, PositionRules> {
  const roster = league.roster;
  const dedicated = (pos: Position) => roster.filter((s) => s.key !== "BN" && s.eligible.length === 1 && s.eligible[0] === pos).length;
  const flex = (pos: Position) => roster.filter((s) => s.key !== "BN" && s.eligible.length > 1 && s.eligible.includes(pos)).length;
  const bench = roster.filter((s) => s.key === "BN").length;

  const rules = {} as Record<Position, PositionRules>;
  for (const pos of POSITIONS) {
    const d = dedicated(pos);
    switch (pos) {
      case "QB": {
        // SUPERFLEX-style slots count as a QB need; FLEX slots without QB eligibility don't.
        const need = d + roster.filter((s) => s.key !== "BN" && s.eligible.length > 1 && s.eligible.includes("QB")).length;
        rules.QB = { need, soft: need, cap: need + 1 };
        break;
      }
      case "TE":
        rules.TE = { need: d, soft: d, cap: d + 1 };
        break;
      case "K":
      case "DST":
        rules[pos] = { need: d, soft: d, cap: d };
        break;
      default: {
        // Prototype (2 starters, 1 FLEX, 7 bench): penalty from 6, hard stop at 8.
        const base = d + flex(pos);
        rules[pos] = { need: d, soft: base + Math.round((bench * 3) / 7), cap: base + Math.round((bench * 5) / 7) };
      }
    }
  }
  return rules;
}

export function createSimContext(league: LeagueSettings, players: Player[]): SimContext {
  return {
    league,
    players,
    byId: new Map(players.map((p) => [p.id, p])),
    byAdp: players.slice().sort((a, b) => a.adp - b.adp),
    byConsensus: players.slice().sort((a, b) => a.consensusRank - b.consensusRank),
    rules: positionRules(league),
    rounds: roundsOf(league),
    total: totalPicks(league),
    teams: [...new Set(players.map((p) => p.team))],
  };
}
