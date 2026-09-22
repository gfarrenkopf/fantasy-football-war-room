import { slugifyName } from "@/lib/data/pipeline/normalize";
import type { Player, Position } from "@/lib/draft/types";
import { canonicalTeam, dstTeam, ESPN_POSITIONS, PRO_TEAMS } from "./proTeams";

/**
 * ESPN player id → the war room's player (8.1).
 *
 * The only job here is telling the board who was taken, so a pick we can't match still has to
 * land somewhere: it resolves `offBoard`, carrying enough to render ("someone took X"). The
 * bundled datasets hold a few hundred players, so late picks in deep leagues are routinely
 * off-board. That's the normal path, not an error.
 */

/** A row of ESPN's public player list (`players?view=players_wl`), trimmed to what we use. */
export interface EspnPlayer {
  id: number;
  fullName: string;
  proTeamId: number;
  defaultPositionId: number;
}

export interface OffBoardPlayer {
  name: string;
  pos: Position | null;
  team: string | null;
}

export type Resolution = { kind: "matched"; playerId: string } | { kind: "offBoard"; player: OffBoardPlayer };

export type Crosswalk = (espnPlayerId: number) => Resolution;

const lastName = (slug: string): string => slug.slice(slug.lastIndexOf("-") + 1);

function group<K>(players: readonly Player[], key: (p: Player) => K): Map<K, Player[]> {
  const out = new Map<K, Player[]>();
  for (const p of players) {
    const k = key(p);
    const list = out.get(k);
    if (list) list.push(p);
    else out.set(k, [p]);
  }
  return out;
}

/** The single candidate on `team`, or the only candidate at all; null when it's ambiguous. */
function pick(candidates: Player[] | undefined, team: string | null): Player | null {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  const onTeam = team ? candidates.filter((p) => canonicalTeam(p.team) === team) : [];
  return onTeam.length === 1 ? onTeam[0] : null;
}

/**
 * Builds a lookup from ESPN's player list against a dataset's players.
 *
 * Matching, in order, stopping at the first unambiguous hit:
 * 1. D/ST by NFL team (ESPN D/ST ids encode the team).
 * 2. Normalized name + position, the way our player ids are built. A traded player still
 *    matches here, because team only breaks ties.
 * 3. Last name + position + team, which covers nickname differences (Kenny vs Kenneth).
 */
export function buildCrosswalk(espnPlayers: readonly EspnPlayer[], players: readonly Player[]): Crosswalk {
  const espnById = new Map(espnPlayers.map((p) => [p.id, p]));
  const dstByTeam = new Map(players.filter((p) => p.pos === "DST").map((p) => [canonicalTeam(p.team), p]));
  const byNamePos = group(players, (p) => `${slugifyName(p.name)}|${p.pos}`);
  const byLastPosTeam = group(players, (p) => `${lastName(slugifyName(p.name))}|${p.pos}|${canonicalTeam(p.team)}`);

  return (espnPlayerId) => {
    const espn = espnById.get(espnPlayerId);
    const dst = dstTeam(espnPlayerId);
    if (dst) {
      const match = dstByTeam.get(dst);
      return match
        ? { kind: "matched", playerId: match.id }
        : { kind: "offBoard", player: { name: espn?.fullName ?? `${dst} D/ST`, pos: "DST", team: dst } };
    }
    if (!espn) return { kind: "offBoard", player: { name: `ESPN player ${espnPlayerId}`, pos: null, team: null } };

    const pos = ESPN_POSITIONS[espn.defaultPositionId] ?? null;
    const team = PRO_TEAMS[espn.proTeamId] ?? null;
    const slug = slugifyName(espn.fullName);
    const match =
      pos &&
      (pick(byNamePos.get(`${slug}|${pos}`), team) ??
        (team ? pick(byLastPosTeam.get(`${lastName(slug)}|${pos}|${team}`), team) : null));
    return match ? { kind: "matched", playerId: match.id } : { kind: "offBoard", player: { name: espn.fullName, pos, team } };
  };
}

/** Validates ESPN's player list response, keeping only well-formed rows. Throws if it isn't a list at all. */
export function parseEspnPlayers(raw: unknown): EspnPlayer[] {
  if (!Array.isArray(raw)) throw new Error("ESPN player list: expected an array");
  return raw.flatMap((r): EspnPlayer[] => {
    const { id, fullName, proTeamId, defaultPositionId } = (r ?? {}) as Partial<EspnPlayer>;
    return typeof id === "number" && typeof fullName === "string" && typeof proTeamId === "number" && typeof defaultPositionId === "number"
      ? [{ id, fullName, proTeamId, defaultPositionId }]
      : [];
  });
}
