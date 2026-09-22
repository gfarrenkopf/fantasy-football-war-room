import { isMyPick } from "@/lib/draft/snake";
import type { DraftPick, LeagueSettings, Player } from "@/lib/draft/types";
import type { LivePick, LiveSnapshot } from "./live";
import { canonicalTeam } from "./proTeams";

/**
 * Turning the relay's live picks into board picks (8.4). Pure, so the war room's sync provider stays
 * a thin wire between the event stream and the draft reducer.
 */

/** Off-board picks get an `espn:` id, which never collides with a dataset slug. */
export const offBoardId = (espnPlayerId: number) => `espn:${espnPlayerId}`;

export function toDraftPicks(picks: readonly LivePick[]): DraftPick[] {
  return picks.map((p) =>
    p.playerId
      ? { playerId: p.playerId, mine: p.mine }
      : { playerId: offBoardId(p.espnPlayerId), mine: p.mine, label: p.offBoard ?? { name: `ESPN player ${p.espnPlayerId}`, pos: null, team: null } },
  );
}

/**
 * How the board should take the live picks: replace them when the feed saw the whole draft, merge
 * when it joined mid-draft, or leave the board alone before any bridge has sent a pick.
 */
export function syncMode(snapshot: Pick<LiveSnapshot, "status" | "anchored" | "picks">): "replace" | "merge" | null {
  if (snapshot.status === "waiting") return null;
  if (snapshot.anchored) return "replace";
  return snapshot.picks.length ? "merge" : null;
}

/**
 * The first of the user's ESPN picks that lands on a pick the war room thinks is someone else's:
 * the league's team count or draft slot doesn't match ESPN. Only meaningful for an anchored feed.
 */
export function slotMismatch(picks: readonly LivePick[], league: Pick<LeagueSettings, "teams" | "mySlot" | "roster">): LivePick | null {
  return picks.find((p) => p.mine && !isMyPick(p.n, league)) ?? null;
}

/**
 * A stand-in Player for an off-board pick, so the roster, needs and bye checks treat it like any other
 * player. Ranked last; its bye comes from the dataset's bye weeks when its team is known, otherwise a
 * unique negative number so it can never collide with anyone's bye. Null when ESPN gave no position.
 */
export function offBoardPlayer(pick: DraftPick, byeWeeks: Record<string, number>, index: number): Player | null {
  const label = pick.label;
  if (!label?.pos) return null;
  const team = label.team ? canonicalTeam(label.team) : null;
  const byeKey = team ? Object.keys(byeWeeks).find((k) => canonicalTeam(k) === team) : undefined;
  return {
    id: pick.playerId,
    name: label.name,
    pos: label.pos,
    team: label.team ?? "FA",
    bye: byeKey ? byeWeeks[byeKey] : -(index + 1),
    consensusRank: 9999,
    adp: 9999,
    posRank: 999,
  };
}
