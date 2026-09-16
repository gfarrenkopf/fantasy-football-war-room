import { computeTiers, type Tier } from "@/lib/draft/tiers";
import { roundOf } from "@/lib/draft/snake";
import { LATE_POSITIONS, type CpuStyle, type Dataset, type LeagueSettings, type Player, type Position } from "@/lib/draft/types";
import { valueTag, type ValueTag } from "@/lib/draft/value";
import { computeTurnPlan, createSimContext, defaultRoom, survival, survivalOdds, turnBoard, type PlanEntry, type Rng, type TurnPlan } from "@/lib/draft/sim";

/** What the engine's own turn plan did with a candidate. */
export type EngineBucket = "target" | "fallback" | "letGo" | null;

export interface PlanCandidate {
  /** Short handle the model answers with ("p12"), so it can't cite a player it wasn't given. */
  ref: string;
  player: Player;
  tier: Tier;
  tag: ValueTag;
  /** Chance he's still available at the turn's first pick (0..1). */
  odds: number;
  /**
   * Chance he's still available at the user's next turn. Null on the last turn, or when the mocks
   * can't tell: the simulated user nearly always drafts him first.
   */
  nextOdds: number | null;
  engine: EngineBucket;
}

export interface PlanInputTurn {
  /** Pick numbers in this turn, e.g. [24, 25]. */
  picks: number[];
  /** Candidates in needs-adjusted order. */
  candidates: PlanCandidate[];
}

/** Everything the prompt is built from: a pre-draft snapshot of the league, the pool, and the mocks. */
export interface PlanInput {
  season: number;
  adpSource: string;
  league: LeagueSettings;
  /** Mocks behind the odds. */
  mocks: number;
  turns: PlanInputTurn[];
  /** ref → player id, for every candidate in every turn. */
  refs: Map<string, string>;
}

/** Candidates the model may target or fall back to: plausibly there (≥ 15%), best first. */
const REACHABLE_ODDS = 0.15;
const MAX_REACHABLE = 12;
/** Per position, so a run of D/STs or RBs can't crowd out the kicker or the QB. */
const MAX_PER_POSITION = 4;
/** How far down the reachable board the per-position cap may reach, so it can't pull in far-off names. */
const MAX_SCANNED = 16;
/** Mocks where the user's simulated picks didn't take him, below which next-turn odds are just noise. */
const MIN_NEXT_SAMPLES = 15;
/** Tempting names that likely won't last, offered as let-go material. */
const MAX_GONE = 3;

/**
 * Builds the model's grounding for a pre-draft plan. For every one of the user's turns, runs the
 * same Monte Carlo odds and needs-adjusted board as the free turn plan, and keeps a short list of
 * candidates: the best players likely to be reachable, plus the tempting ones ranked around the
 * pick who probably won't be. The model picks and orders from these lists and nothing else.
 */
export function buildPlanInput(
  league: LeagueSettings,
  dataset: Pick<Dataset, "season" | "adpSource" | "players">,
  { n = 300, rng, room = defaultRoom(league.teams) }: { n?: number; rng: Rng; room?: CpuStyle[] },
): PlanInput {
  const ctx = createSimContext(league, dataset.players);
  const odds = survivalOdds([], room, ctx, { n, rng });
  const tiers = computeTiers(dataset.players, league);
  const chance = (id: string, turn: number) => {
    const o = odds.players.get(id);
    return o ? survival(o, turn) : 0;
  };
  const nextChance = (id: string, turn: number) => {
    const o = odds.players.get(id);
    if (turn + 1 >= odds.turns.length || !o || (1 - o.mine[turn + 1]) * odds.n < MIN_NEXT_SAMPLES) return null;
    return survival(o, turn + 1);
  };

  const refs = new Map<string, string>();
  const refOf = new Map<string, string>();
  const ref = (id: string) => {
    let r = refOf.get(id);
    if (!r) {
      r = `p${refOf.size + 1}`;
      refOf.set(id, r);
      refs.set(r, id);
    }
    return r;
  };

  /** Players offered as reachable at an earlier turn: they may already be on the plan, so they're never let-go material. */
  const offeredEarlier = new Set<string>();
  const turns = odds.turns.map((_, turn): PlanInputTurn => {
    const board = turnBoard([], odds, ctx, turn)!;
    const engine = bucketsOf(computeTurnPlan([], odds, ctx, turn)!);
    const goneFromRank = board.picks[0] - league.teams / 2;

    const reachable: PlanEntry[] = [];
    const perPosition = new Map<Position, number>();
    let scanned = 0;
    for (const e of board.entries) {
      if (e.survival < REACHABLE_ODDS) continue;
      if (++scanned > MAX_SCANNED) break;
      const n = perPosition.get(e.player.pos) ?? 0;
      if (n >= MAX_PER_POSITION) continue;
      perPosition.set(e.player.pos, n + 1);
      if (reachable.push(e) === MAX_REACHABLE) break;
    }
    // Once K and D/ST are in play (the same late rounds the simulator drafts them), always offer one.
    // Straight from the odds, not the board: the board assumes the simulated user already has one.
    if (roundOf(board.picks.at(-1)!, league.teams) >= ctx.rounds - 3) {
      for (const pos of LATE_POSITIONS) {
        if (perPosition.has(pos)) continue;
        const player = ctx.byConsensus.find((p) => p.pos === pos && chance(p.id, turn) >= REACHABLE_ODDS);
        if (player) reachable.push({ player, survival: chance(player.id, turn) });
      }
    }
    const letGoMaterial = (e: PlanEntry) => e.survival < REACHABLE_ODDS && !offeredEarlier.has(e.player.id);
    // Nobody is holding out hope for a particular kicker or defense, so K and D/ST are never let-go material.
    const gone = board.entries
      .filter((e) => letGoMaterial(e) && !LATE_POSITIONS.includes(e.player.pos) && e.player.consensusRank >= goneFromRank)
      .slice(0, MAX_GONE);
    // Keep the engine's targets, so the model can always agree with it.
    const listed = board.entries.filter((e) => engine.get(e.player.id) === "target" && !reachable.includes(e));
    for (const e of reachable) offeredEarlier.add(e.player.id);

    const candidates = [...reachable, ...listed, ...gone].map(
      (e): PlanCandidate => ({
        ref: ref(e.player.id),
        player: e.player,
        tier: tiers.get(e.player.id) ?? 5,
        tag: valueTag(e.player, league.valueThreshold),
        odds: e.survival,
        nextOdds: nextChance(e.player.id, turn),
        engine: engine.get(e.player.id) === "letGo" && !gone.includes(e) ? null : (engine.get(e.player.id) ?? null),
      }),
    );
    return { picks: board.picks, candidates };
  });

  return { season: dataset.season, adpSource: dataset.adpSource, league, mocks: odds.n, turns, refs };
}

function bucketsOf(plan: TurnPlan): Map<string, Exclude<EngineBucket, null>> {
  const out = new Map<string, Exclude<EngineBucket, null>>();
  for (const e of plan.targets) out.set(e.player.id, "target");
  for (const e of plan.fallbacks) out.set(e.player.id, "fallback");
  for (const e of plan.letGo) out.set(e.player.id, "letGo");
  return out;
}
