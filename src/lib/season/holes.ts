import { rosterLimit } from "./acquire";
import { canPlay, irEligible, label } from "./apply";
import { pickDrops } from "./drops";
import { isRuledOut } from "./lineup";
import { seasonLineup } from "./trade";
import type { FreeAgent, LineupSlotCount } from "./types";
import { likelyOut, onBye, type SeasonView, type ViewPlayer } from "./view";

/**
 * Holes in this week's lineup (APE-349): a starting slot that even the best lineup can't fill with a
 * player who'll play. The optimal lineup (lineup.ts) starts anyone over nobody, so a team's only QB
 * stays in his slot when ESPN rules him out, and "Your lineup is set" would be a lie. Holes are found
 * in the recommended lineup, not ESPN's: a bench player who can fill the slot is a swap, not a hole.
 *
 * - Hard: the slot's best fill is ruled out (OUT, IR, suspended), on a bye, or there's nobody at all.
 * - Soft: ESPN projects him for nothing although his team plays (likely out), or he's DOUBTFUL with
 *   no one on the bench who could take his place. Something to watch, not a verdict.
 *
 * A slot whose player's game has started can't change, so it's never a hole: it's just his points.
 */

type StarterKey = LineupSlotCount["key"];

export type HoleReason = "out" | "bye" | "empty" | "likely-out" | "doubtful";

export interface Hole {
  key: StarterKey;
  kind: "hard" | "soft";
  reason: HoleReason;
  /** Who's in the slot in the recommended lineup; null when nobody is. */
  playerId: number | null;
  /** His kickoff, as an ISO instant; null on a bye, for an empty slot, or when ESPN didn't say. */
  kickoff: string | null;
}

const SOFT: ReadonlySet<HoleReason> = new Set(["likely-out", "doubtful"]);

/** Whether the player's game this week has kicked off. */
export const started = (p: Pick<ViewPlayer, "actual" | "game" | "locked">) => p.locked || p.actual !== null || (!!p.game && p.game.state !== "pre");

/** Why `p` can't be counted on in his slot this week, if he can't. */
function reasonFor(p: ViewPlayer | undefined, bench: readonly ViewPlayer[], key: StarterKey): HoleReason | null {
  if (!p) return "empty";
  if (isRuledOut(p.injuryStatus)) return "out";
  if (onBye(p)) return "bye";
  if (likelyOut(p)) return "likely-out";
  if (p.injuryStatus === "DOUBTFUL" && !bench.some((b) => canPlay(b.pos, key) && !isRuledOut(b.injuryStatus) && !started(b) && b.points > 0)) return "doubtful";
  return null;
}

/** This week's holes in the user's lineup, hard ones first, in lineup order within each. */
export function findHoles(view: SeasonView): Hole[] {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const bench = view.lineup.bench.flatMap((id) => byId.get(id) ?? []);
  const holes = view.lineup.starters.flatMap((fill): Hole[] => {
    const p = fill.playerId === null ? undefined : byId.get(fill.playerId);
    if (fill.locked || (p && started(p))) return [];
    const reason = reasonFor(p, bench, fill.key);
    if (!reason) return [];
    return [{ key: fill.key, kind: SOFT.has(reason) ? "soft" : "hard", reason, playerId: p?.playerId ?? null, kickoff: p?.game?.kickoff ?? null }];
  });
  return [...holes.filter((h) => h.kind === "hard"), ...holes.filter((h) => h.kind === "soft")];
}

/** An available player as the waiver wire reads him: scored for this league, with his ESPN status. */
export type PoolPlayer = ViewPlayer & Pick<FreeAgent, "status" | "waiverClears">;

/** One way to fill a hole: who to add, and how to make room for him. */
export interface Fill {
  player: PoolPlayer;
  /** Who to drop to make room; null when there's room, or IR makes it. */
  drop: number | null;
  /** The hole's player, moved to IR first to make room; null when not. */
  ir: number | null;
}

export interface HoleFills {
  hole: Hole;
  /** Free agents to add now, best first. Empty when nobody can play in time. */
  fills: Fill[];
  /** Waiver claims that clear before the player's game, best first: claimed from Waivers, not here. */
  claims: Fill[];
}

/** How many ways to fill each hole the page offers. */
export const FILL_OPTIONS = 3;

/** Whether `p` could start in `key` this week if he were on the roster now. */
function canFill(p: PoolPlayer, key: StarterKey, now: number): boolean {
  if (!canPlay(p.pos, key) || isRuledOut(p.injuryStatus) || p.points <= 0 || started(p)) return false;
  if (p.status === "FREEAGENT") return true;
  // A claim has to clear before his game does.
  const kickoff = p.game?.kickoff ? Date.parse(p.game.kickoff) : NaN;
  const clears = p.waiverClears ? Date.parse(p.waiverClears) : NaN;
  return Number.isFinite(kickoff) && Number.isFinite(clears) && clears > now && clears < kickoff;
}

/**
 * The best ways to fill each hard hole, from the available players in `pool`. A hole is a this-week
 * problem, so fills rank by this week's points, with rest of season only breaking ties: a one-week
 * streamer at QB beats a stash who sits.
 *
 * Making room: the hole's player goes to IR when he qualifies and a spot is open; otherwise the
 * drop comes from the shared rule (drops.ts), never a player starting elsewhere or one whose game
 * has started. The hole's own player is cut instead only when he's worth less for the rest of the
 * season than the drop the rule picked. Holes are filled in turn, so two never share a player or a drop, and the
 * second sees the roster the first's best fill would leave.
 */
export function rankFills(view: SeasonView, holes: readonly Hole[], pool: readonly PoolPlayer[], now: number): HoleFills[] {
  let roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  let irOpen = view.irSlots - roster.filter((p) => p.slot === "IR").length;
  const limit = rosterLimit(view.starters, view.benchSize);
  const starting = new Set(view.lineup.starters.flatMap((s) => (s.playerId === null ? [] : [s.playerId])));
  const taken = new Set<number>();

  return holes
    .filter((h) => h.kind === "hard")
    .map((hole) => {
      const holder = hole.playerId === null ? undefined : roster.find((p) => p.playerId === hole.playerId);
      const toIr = holder && irOpen > 0 && irEligible(holder) && !holder.locked ? holder.playerId : null;
      const room = (p: PoolPlayer): Fill => {
        const counted = roster.filter((r) => r.slot !== "IR" && r.playerId !== toIr);
        if (counted.length + 1 <= limit) return { player: p, drop: null, ir: toIr };
        const keep = new Set([...starting, p.playerId]);
        const [drop = null] = pickDrops([...counted, p], 1, view, { keep, droppable: (x) => !x.locked });
        return { player: p, drop: holderDrop(roster, holder, drop, p, view) ?? drop, ir: null };
      };
      const ranked = pool
        .filter((p) => !taken.has(p.playerId) && canFill(p, hole.key, now))
        .sort((a, b) => b.points - a.points || b.ros - a.ros || a.playerId - b.playerId);
      const fills = ranked.filter((p) => p.status === "FREEAGENT").slice(0, FILL_OPTIONS).map(room);
      const claims = ranked.filter((p) => p.status === "WAIVERS").slice(0, FILL_OPTIONS).map(room);

      // The roster the best fill leaves, for the next hole.
      const best = fills[0];
      if (best) {
        taken.add(best.player.playerId);
        if (best.ir !== null) irOpen--;
        roster = [...roster.filter((r) => r.playerId !== best.drop).map((r) => (r.playerId === best.ir ? { ...r, slot: "IR" as const } : r)), best.player];
        starting.add(best.player.playerId);
      }
      return { hole, fills, claims };
    });
}

/**
 * The hole's own player as the drop instead, when he's worth less than `drop` for the rest of the
 * season, and cutting him costs the best lineup nothing that cutting `drop` wouldn't: a player out
 * for the year, with IR full. A star out for a week is worth more, so he stays.
 */
function holderDrop(roster: readonly ViewPlayer[], holder: ViewPlayer | undefined, drop: number | null, add: PoolPlayer, view: SeasonView): number | null {
  const other = roster.find((p) => p.playerId === drop);
  if (!holder || holder.locked || !other || holder.ros >= other.ros) return null;
  const without = (id: number) => seasonLineup([...roster.filter((p) => p.playerId !== id), add], view).total;
  return without(holder.playerId) >= without(other.playerId) ? holder.playerId : null;
}

/** "QB", or "QB and TE", or "QB, RB and TE": the slots of these holes, as the page names them. */
export function holeSlots(holes: readonly Pick<Hole, "key">[]): string {
  const names = [...new Set(holes.map((h) => label(h.key)))];
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
