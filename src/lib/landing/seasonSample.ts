import type { Position } from "@/lib/draft/types";

/**
 * The in-season landing page's sample week (APE-340): one team, one opponent, the lineup Draft
 * Room would change, a trade and a pickup, and when the NFL season runs. It is marketing, not a
 * feed: `scripts/season-sample.mts` builds it once a season from ESPN's public player data, and
 * the page never fetches anything. The players are real so the page looks current; the win chances,
 * what the swapped players scored, and the final are picked by hand.
 */

export interface SamplePlayer {
  name: string;
  pos: Position;
  /** NFL team abbreviation. */
  team: string;
  /** This week's game from the player's side: "vs CAR", "@ BAL". */
  game: string;
  /** ESPN's projection for the week, in PPR points. */
  proj: number;
}

export interface SampleSlot {
  /** The lineup slot: QB, RB, WR, TE, FLEX, K, D/ST. */
  slot: string;
  player: SamplePlayer;
}

export interface SampleSwap {
  /** Index into `lineup` of the slot that changes. */
  slot: number;
  /** The starter by rank, benched. */
  out: SamplePlayer;
  /** The bench player Draft Room starts instead. */
  in: SamplePlayer;
  /** What each one actually scored that week, picked by hand: the call paying off. */
  points: { in: number; out: number };
}

export interface SeasonSample {
  season: number;
  /** When the landing page shows its season face: week 1's first kickoff to after the fantasy final (ISO). */
  window: { start: string; end: string };
  you: string;
  opponent: string;
  /** The lineup by rank, slot by slot. */
  lineup: SampleSlot[];
  bench: SamplePlayer[];
  swaps: SampleSwap[];
  /** The opponent's projected total. */
  opponentProj: number;
  /** Chance to win with the lineup by rank, then with Draft Room's (0–1). */
  winChance: { before: number; after: number };
  /** The week's final: the win moment. */
  final: { you: number; opponent: number };
  /** The player who won it, and what he scored. */
  star: { name: string; points: number };
  trade: {
    partner: string;
    send: SamplePlayer[];
    get: SamplePlayer[];
    /** Points a week each side gains, rest of season. */
    gain: { you: number; partner: number };
    why: string;
  };
  waiver: { add: SamplePlayer; drop: SamplePlayer; gain: number; owned: number };
  /** The rest of the league's week, for the hero's backdrop. */
  scoreboard: { home: string; away: string; homeScore: number; awayScore: number }[];
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Checks the shape the page relies on, so a bad regeneration fails the build rather than the page. */
export function validateSeasonSample(raw: unknown): SeasonSample {
  const fail = (what: string): never => {
    throw new Error(`season sample: ${what}`);
  };
  if (!isObject(raw)) return fail("not an object");
  const { window, lineup, bench, swaps, winChance, final } = raw;
  if (!isObject(window) || Number.isNaN(Date.parse(String(window.start))) || Number.isNaN(Date.parse(String(window.end)))) return fail("window");
  if (Date.parse(String(window.start)) >= Date.parse(String(window.end))) return fail("window ends before it starts");
  if (!Array.isArray(lineup) || lineup.length === 0) return fail("lineup");
  if (!Array.isArray(bench)) return fail("bench");
  if (!Array.isArray(swaps) || swaps.length === 0) return fail("swaps");
  for (const swap of swaps) {
    if (!isObject(swap) || typeof swap.slot !== "number" || !lineup[swap.slot]) return fail("swap slot");
    if (!isObject(swap.points) || !(Number(swap.points.in) > Number(swap.points.out))) return fail("each swap must outscore the starter it benched");
  }
  if (!isObject(winChance) || !(Number(winChance.before) < 0.5 && Number(winChance.after) > 0.5)) return fail("win chances must cross 50%");
  if (!isObject(final) || !(Number(final.you) > Number(final.opponent))) return fail("the final must be a win");
  // The hero's claim: without Draft Room's calls, the week is a loss.
  if (!(callsWorth(swaps as SampleSwap[]) > Number(final.you) - Number(final.opponent))) return fail("the swaps must be worth more than the margin");
  return raw as unknown as SeasonSample;
}

/** The lineup Draft Room sets: the lineup by rank with every swap made. */
export function draftRoomLineup(sample: SeasonSample): SampleSlot[] {
  const out = sample.lineup.map((s) => ({ ...s }));
  for (const swap of sample.swaps) out[swap.slot] = { ...out[swap.slot], player: swap.in };
  return out;
}

/** Points Draft Room's swaps actually won you: what each started player scored over the one he benched. */
export const callsWorth = (swaps: readonly SampleSwap[]) => Math.round(swaps.reduce((sum, sw) => sum + sw.points.in - sw.points.out, 0) * 10) / 10;

export const lineupTotal = (lineup: readonly SampleSlot[]) => Math.round(lineup.reduce((sum, s) => sum + s.player.proj, 0) * 10) / 10;

export type LandingMode = "draft" | "season";

/**
 * Which landing page shows. `auto` follows the season window; `draft` and `season` force one, for
 * testing and edge cases. The season face needs the in-season features, so without them it's the
 * draft page whatever the override says.
 */
export function landingMode(override: "auto" | LandingMode, seasonAvailable: boolean, now: number, window: SeasonSample["window"]): LandingMode {
  if (!seasonAvailable) return "draft";
  if (override !== "auto") return override;
  return now >= Date.parse(window.start) && now < Date.parse(window.end) ? "season" : "draft";
}
