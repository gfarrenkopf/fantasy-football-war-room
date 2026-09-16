import type { Dataset, Player, Position, ScoringFormat } from "@/lib/draft/types";
import type { SdFantasyPlayer, SdSnapshot } from "../sportsdata/types";
import { rankPlayers, type Rankable } from "./ranks";

/**
 * Turns a captured SportsDataIO snapshot into a `Dataset` (2.2).
 *
 * Joins three responses: FantasyPlayers supplies ADP, team, position and bye;
 * PlayerSeasonProjectionStats supplies projected points (joined on PlayerID);
 * Byes is the authoritative bye-week source and overrides FantasyPlayers.ByeWeek,
 * which is missing on a few rows.
 */

/** SportsDataIO says DEF; the app says DST. Everything else matches. */
const POSITIONS: Record<string, Position> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DST",
};

/**
 * Player ids are the pipeline's most dangerous output. Saved drafts store picks by
 * `Player.id`, so an id that changes between refreshes silently orphans every logged
 * pick — the player is still on the board and the user's roster has a hole. The format
 * is also documented for self-hosters (`name-pos-team`), so it has to stay readable
 * rather than become an opaque numeric key.
 *
 * Normalization therefore has to be lossless in the ways that matter and stable in the
 * ways that don't: strip accents and punctuation, drop generational suffixes (a player
 * gaining or losing a "Jr." in the source data must not change his id), and collapse
 * whitespace.
 */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function slugifyName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents: Ekelé -> Ekele
    .toLowerCase()
    .replace(/[.'’]/g, "") // D.J. -> dj, Ja'Marr -> jamarr
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter((w) => w && !SUFFIXES.has(w));
  return (words.length ? words : cleaned.split(" ")).join("-");
}

/**
 * `name-pos-team`, matching the format documented in docs/self-hosting.md.
 *
 * Team is part of the id because it's in the documented format, which means a traded
 * player's id changes and his saved picks are orphaned. That's a real limitation and
 * deliberately not papered over here — changing it would break every existing saved
 * draft and every self-hoster's hand-written file. The changelog (2.4) reports team
 * changes so the damage is at least visible.
 */
export function playerId(name: string, pos: Position, team: string): string {
  return `${slugifyName(name)}-${pos.toLowerCase()}-${team.toLowerCase()}`;
}

export interface NormalizeOptions {
  season: number;
  label: string;
  /** Name of the platform the ADP came from, shown on cards. */
  adpSource?: string;
  /**
   * Scoring formats the output claims to support. The league dialog disables any
   * format not listed, so only claim what the ADP source actually covers.
   */
  scoring?: ScoringFormat[];
}

export interface NormalizeResult {
  dataset: Dataset;
  /** Rows dropped before ranking, with the reason, for the run report. */
  dropped: { name: string; reason: string }[];
}

const isUsable = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function normalize(snapshot: SdSnapshot, options: NormalizeOptions): NormalizeResult {
  const { season, label, adpSource = "SportsDataIO", scoring = ["ppr"] } = options;
  const dropped: { name: string; reason: string }[] = [];

  // Authoritative bye weeks, keyed by team.
  const byeWeeks: Record<string, number> = {};
  for (const b of snapshot.byes) {
    if (b.Team && isUsable(b.Week)) byeWeeks[b.Team] = b.Week;
  }

  const projById = new Map(snapshot.projections.map((p) => [p.PlayerID, p]));

  interface Draft extends Rankable {
    row: SdFantasyPlayer;
    name: string;
    team: string;
    bye: number;
  }

  const drafts: Draft[] = [];
  const seenIds = new Set<string>();

  for (const row of snapshot.fantasyPlayers) {
    const pos = POSITIONS[row.Position];
    if (!pos) {
      dropped.push({ name: row.Name, reason: `unmapped position "${row.Position}"` });
      continue;
    }
    // Free agents have no team, so no bye week and no meaningful id. They're also
    // undraftable in any real league.
    if (!row.Team || row.Team === "FA") {
      dropped.push({ name: row.Name, reason: "no team (free agent)" });
      continue;
    }
    const bye = byeWeeks[row.Team] ?? (isUsable(row.ByeWeek) ? row.ByeWeek : undefined);
    if (bye === undefined) {
      dropped.push({ name: row.Name, reason: `no bye week for team ${row.Team}` });
      continue;
    }

    const id = playerId(row.Name, pos, row.Team);
    if (seenIds.has(id)) {
      // Two players normalizing to the same slug. Dropping the second is wrong, but so is
      // silently overwriting the first; the QA step reports these so they can be fixed.
      dropped.push({ name: row.Name, reason: `duplicate id "${id}"` });
      continue;
    }
    seenIds.add(id);

    const projection = projById.get(row.PlayerID);
    const projPoints = isUsable(projection?.FantasyPointsPPR) ? projection.FantasyPointsPPR : undefined;

    drafts.push({
      row,
      id,
      name: row.Name,
      pos,
      team: row.Team,
      bye,
      projPoints,
      adp: isUsable(row.AverageDraftPositionPPR) ? row.AverageDraftPositionPPR : 0,
    });
  }

  const ranks = rankPlayers(drafts);

  /**
   * `adp` ships as a *rank over this dataset's players*, not the raw average draft
   * position the API returns.
   *
   * `valueTag()` is `adp - consensusRank`, which is only meaningful if both sides are
   * measured on the same scale and the same population. The raw field isn't: SportsDataIO
   * computes ADP across every player it tracks (values run past 1600), while
   * consensusRank is dense over the ~700 players that survive filtering. Comparing them
   * directly tags ~92% of the board "Value" — as useless as tagging none of it.
   *
   * Converting ADP to a dense rank over the retained pool matches the shipped sample
   * data, where adp runs 1..198 against consensusRank 1..205, and is what the
   * documented field ("overall average draft position on your platform") means in
   * practice for a board of this size.
   */
  const drafted = drafts.filter((d) => d.adp > 0).sort((a, b) => a.adp - b.adp || a.id.localeCompare(b.id));
  const adpRanks = new Map(drafted.map((d, i) => [d.id, i + 1]));

  const players: Player[] = drafts.map((d) => {
    const rank = ranks.get(d.id)!;
    const player: Player = {
      id: d.id,
      name: d.name,
      pos: d.pos,
      team: d.team,
      bye: d.bye,
      consensusRank: rank.consensusRank,
      // An undrafted player has no market signal at all. Mirroring his consensus rank
      // keeps the field a real number without inventing one, and leaves him "even".
      adp: adpRanks.get(d.id) ?? rank.consensusRank,
      posRank: rank.posRank,
    };
    if (d.projPoints !== undefined) player.projPoints = d.projPoints;
    return player;
  });

  // Ranks are dense over the whole pool, so sorting by them yields the board order.
  players.sort((a, b) => a.consensusRank - b.consensusRank);

  return {
    dataset: { season, label, adpSource, scoring, byeWeeks, players },
    dropped,
  };
}
