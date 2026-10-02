import { formatRoundPick, slotOf } from "./snake";
import { LATE_POSITIONS, type DraftPick, type LeagueSettings, type PickLabel, type Player } from "./types";

/** One pick of the whole draft, as the post-draft room tells it. */
export interface RecapPick {
  /** Overall pick number, 1-based. */
  n: number;
  /** Round.pick, e.g. "4.07". */
  roundPick: string;
  /** Draft slot (1..teams) that made the pick: the user's own slot for their picks. */
  slot: number;
  mine: boolean;
  /** The dataset player, or null for an off-board pick, which only has its label. */
  player: Player | null;
  label: PickLabel | null;
  /**
   * How many picks after the consensus rank he went: positive means he fell. Null for K and D/ST
   * (the same rule as Value/Reach tags) and for off-board picks, which have no rank.
   */
  gain: number | null;
}

/** How one draft slot's picks landed against consensus. */
export interface RecapTeam {
  slot: number;
  /** Picks that came after the consensus rank (`k`) out of the picks that can be judged (`n`). */
  k: number;
  n: number;
}

/** Everything the post-draft room says about the whole draft. */
export interface DraftRecap {
  picks: RecapPick[];
  /** The biggest fall and the biggest reach by anyone; a reach under the league's threshold isn't one. */
  league: { steal: RecapPick | null; reach: RecapPick | null };
  /** The same, among the user's own picks. */
  mine: { steal: RecapPick | null; reach: RecapPick | null };
  /** Every slot, in slot order. */
  teams: RecapTeam[];
  /** The slot whose picks beat consensus most often (share, then count), or null with nothing judged. */
  sharpest: RecapTeam | null;
}

/** Earliest pick wins a tie, so the story names the first time it happened. */
function most(picks: RecapPick[], score: (p: RecapPick) => number): RecapPick | null {
  return picks.reduce<RecapPick | null>((top, p) => (!top || score(p) > score(top) ? p : top), null);
}

/**
 * Builds the recap from a finished (or partial) draft. `ranked` looks up dataset players only:
 * an off-board pick has no consensus rank to judge it by.
 */
export function draftRecap(picks: readonly DraftPick[], ranked: (id: string) => Player | undefined, league: Pick<LeagueSettings, "teams" | "mySlot" | "valueThreshold">): DraftRecap {
  const { teams } = league;
  const all = picks.map((pick, i): RecapPick => {
    const n = i + 1;
    const player = ranked(pick.playerId) ?? null;
    return {
      n,
      roundPick: formatRoundPick(n, teams),
      slot: pick.mine ? league.mySlot : slotOf(n, teams),
      mine: pick.mine,
      player,
      label: pick.label ?? null,
      gain: player && !LATE_POSITIONS.includes(player.pos) ? n - player.consensusRank : null,
    };
  });

  const judged = all.filter((p) => p.gain !== null);
  const notable = (from: RecapPick[]) => {
    const steal = most(
      from.filter((p) => p.gain! > 0),
      (p) => p.gain!,
    );
    const reach = most(
      from.filter((p) => -p.gain! >= league.valueThreshold),
      (p) => -p.gain!,
    );
    return { steal, reach };
  };

  const recapTeams = Array.from({ length: teams }, (_, i): RecapTeam => {
    const own = judged.filter((p) => p.slot === i + 1);
    return { slot: i + 1, k: own.filter((p) => p.gain! > 0).length, n: own.length };
  });
  const sharpest = recapTeams
    .filter((t) => t.n > 0)
    .reduce<RecapTeam | null>((top, t) => (!top || t.k / t.n > top.k / top.n || (t.k / t.n === top.k / top.n && t.k > top.k) ? t : top), null);

  return {
    picks: all,
    league: notable(judged),
    mine: notable(judged.filter((p) => p.mine)),
    teams: recapTeams,
    sharpest,
  };
}
