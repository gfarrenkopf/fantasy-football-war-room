import type { Emphasis } from "./emphasis";
import { compareLineups, isRuledOut, type LineupPlan } from "./lineup";
import type { LineupSlotCount } from "./types";
import { likelyOut, onBye, type ViewPlayer } from "./view";

/**
 * The start/sit hero on the Lineup tab (10.8, APE-338): the headline, the swaps War Room suggests
 * and why a starter comes out. Shared by the season page and the iPhone app's season route (APE-379),
 * so both say the same.
 */

/** ESPN's injury designations, in the short form managers use. */
export const INJURY_TAG: Record<string, string> = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "OUT", INJURY_RESERVE: "IR", SUSPENSION: "SSPD" };

/** The hero's headline at each level of gain. */
export const LINEUP_HEADLINE: Record<Emphasis, string> = {
  rest: "Your lineup is set",
  trim: "A small tweak",
  gain: "Worth a swap",
  swing: "Big swing on your bench",
  must: "Points stuck on your bench",
};

export interface OutTag {
  label: string;
  kind: "out" | "warn";
}

/**
 * Why a starter is coming out, when it's news, in the word managers use: his designation (OUT, IR,
 * SSPD), BYE, or LIKELY OUT when ESPN projects him for nothing with a game to play (APE-338). That
 * last is ESPN's guess, not a designation, so it's amber rather than red.
 */
export function outTag(p: ViewPlayer): OutTag | null {
  if (isRuledOut(p.injuryStatus)) return { label: INJURY_TAG[p.injuryStatus] ?? "OUT", kind: "out" };
  if (onBye(p)) return { label: "BYE", kind: "out" };
  if (likelyOut(p)) return { label: "LIKELY OUT", kind: "warn" };
  return null;
}

/** One swap War Room suggests: who starts in the slot and who sits for him, either null for an empty seat. */
export interface StartSitSwap {
  key: LineupSlotCount["key"];
  into: number | null;
  out: number | null;
  /** The starter's projection over the benched player's. */
  gain: number;
  /** Why the benched player comes out, when it's news. */
  tag: OutTag | null;
}

/** War Room's suggested swaps, slot by slot, against the lineup on ESPN. */
export function startSitSwaps(roster: readonly ViewPlayer[], plan: LineupPlan): StartSitSwap[] {
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  return compareLineups(roster, plan)
    .filter((r) => r.changed)
    .map((r) => {
      const into = r.next === null ? undefined : byId.get(r.next);
      const out = r.now === null ? undefined : byId.get(r.now);
      return { key: r.key, into: r.next, out: r.now, gain: (into?.points ?? 0) - (out?.points ?? 0), tag: out ? outTag(out) : null };
    });
}
