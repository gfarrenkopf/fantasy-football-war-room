import type { Position } from "@/lib/draft/types";
import type { ProjectionAccuracy } from "./accuracy";
import { optimalLineup } from "./lineup";
import { weekRecap } from "./recap";
import type { SeasonView } from "./view";

/**
 * Why the week went the way it did (APE-243): ESPN's margin before kickoff, then the players who
 * moved it, until it lands on the final. Each player's swing is what he scored against his
 * projection: the user's starters push the margin their way, the opponent's push it back. The swings
 * plus "everyone else" always add up to the final margin, so the story never disagrees with the
 * score. Pure, so the card and its tests tell it the same way.
 */

export interface Swing {
  playerId: number;
  name: string;
  pos: Position;
  /** Whose starter: the user's ("me") or the opponent's ("them"). */
  side: "me" | "them";
  points: number;
  projected: number;
  /** What he did to the user's margin: his points over (or under) his projection, signed for the user. */
  delta: number;
  /** The margin before and after him, running from ESPN's call to the final. */
  before: number;
  after: number;
}

export interface WeekSwing {
  /** The user's projected margin before kickoff: their starters' projections less the opponent's. */
  projected: number;
  /** The final margin, the user's score less the opponent's. */
  final: number;
  /** The biggest swings, in the order they're told: largest first. */
  swings: Swing[];
  /** Everyone else together, and the rounding; null when it's under a tenth. */
  rest: { delta: number; before: number; after: number } | null;
  /** Each side's starters against their projections. */
  mine: number;
  theirs: number;
  /** The user's starters ESPN projected for nothing who scored nothing: out, on IR, or on a bye. */
  empty: string[];
  /** The user's best lineup in hindsight, when it beat the one they set by a point or more. */
  hindsight: { total: number; gain: number; wouldHaveWon: boolean; best: { name: string; points: number } | null } | null;
}

/** How many players the story names, and the smallest swing worth naming. */
const MAX_SWINGS = 4;
const MIN_SWING = 2;

const round = (n: number) => Math.round(n * 10) / 10;

export function weekSwing(view: SeasonView, accuracy: ProjectionAccuracy | null): WeekSwing | null {
  const recap = weekRecap(view, accuracy);
  if (!recap || !view.matchup) return null;
  const theirRoster = view.teams.find((t) => t.id === view.matchup!.them.teamId)?.roster ?? [];
  const candidates: Omit<Swing, "before" | "after">[] = [
    ...recap.starters.map((p) => ({ playerId: p.playerId, name: p.name, pos: p.pos, side: "me" as const, points: p.points, projected: p.projected, delta: round(p.points - p.projected) })),
    ...theirRoster
      .filter((p) => p.slot !== "BN" && p.slot !== "IR")
      .map((p) => ({ playerId: p.playerId, name: p.name, pos: p.pos, side: "them" as const, points: p.actual ?? 0, projected: p.points, delta: round(p.points - (p.actual ?? 0)) })),
  ];
  const projected = round(
    recap.starters.reduce((sum, p) => sum + p.projected, 0) -
      theirRoster.filter((p) => p.slot !== "BN" && p.slot !== "IR").reduce((sum, p) => sum + p.points, 0),
  );
  const final = round(recap.me - recap.them);

  const named = candidates
    .filter((c) => Math.abs(c.delta) >= MIN_SWING)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MAX_SWINGS);
  let running = projected;
  const swings = named.map((c): Swing => {
    const before = running;
    running = round(running + c.delta);
    return { ...c, before, after: running };
  });
  const left = round(final - running);
  const rest = Math.abs(left) >= 0.1 ? { delta: left, before: running, after: final } : null;

  const sum = (side: "me" | "them") => round(candidates.filter((c) => c.side === side).reduce((s, c) => s + (side === "me" ? c.delta : -c.delta), 0));
  const empty = recap.starters.filter((p) => p.projected === 0 && p.points === 0).map((p) => p.name);
  return { projected, final, swings, rest, mine: sum("me"), theirs: sum("them"), empty, hindsight: hindsightOf(view, recap.me, recap.them) };
}

/** The best lineup the user could have set, knowing the points: every non-IR player at his actual score. */
function hindsightOf(view: SeasonView, me: number, them: number): WeekSwing["hindsight"] {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const played = roster.filter((p) => p.slot !== "IR").map((p) => ({ ...p, points: p.actual ?? 0, locked: false, injuryStatus: "ACTIVE" as const }));
  const plan = optimalLineup(played, view.starters);
  const gain = round(plan.total - me);
  if (gain < 1) return null;
  const set = new Set(roster.filter((p) => p.slot !== "BN" && p.slot !== "IR").map((p) => p.playerId));
  const benched = plan.starters.flatMap((f) => (f.playerId !== null && !set.has(f.playerId) ? [played.find((p) => p.playerId === f.playerId)!] : []));
  const best = benched.sort((a, b) => b.points - a.points)[0];
  return { total: round(plan.total), gain, wouldHaveWon: me <= them && plan.total > them, best: best ? { name: best.name, points: best.points } : null };
}
