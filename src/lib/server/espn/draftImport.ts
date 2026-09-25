import "server-only";
import { dataset } from "@/lib/data";
import type { Db } from "@/lib/db/types";
import { DRAFT_STATE_VERSION } from "@/lib/draft/state";
import { buildCrosswalk, type Crosswalk } from "@/lib/espn/crosswalk";
import { importedPicks, parseFinishedDraft } from "@/lib/espn/draftImport";
import { findLeague, getDraft, putDraft } from "../leagues";
import { readEspnLeague } from "./leagueReader";
import { loadLogin } from "./logins";
import { getEspnPlayers } from "./players";
import { findSeasonLink } from "./seasonLinks";

/**
 * Bringing a finished ESPN draft onto a league's board (APE-193). A league connected for the season
 * after its draft (from the season bookmarklet, not live sync) would otherwise open on an empty board,
 * and the draft room would premiere it as a draft still to come. Only ever fills an empty board:
 * picks the user logged, or live sync saved, are never replaced.
 */

export type DraftImport = "imported" | "not-finished" | "has-picks" | "mismatch" | "no-league";

export interface DraftImportDeps {
  crosswalkFor?: (season: number) => Promise<Crosswalk>;
}

const defaultCrosswalk = async (season: number) => buildCrosswalk(await getEspnPlayers(season), dataset.players);

/** Imports the finished draft in `raw` (ESPN's league document with `mDraftDetail`) onto an empty board. */
export async function importEspnDraft(
  db: Db,
  userId: string,
  leagueId: string,
  raw: unknown,
  { espnTeamId, season }: { espnTeamId: number; season: number },
  { crosswalkFor = defaultCrosswalk }: DraftImportDeps = {},
): Promise<DraftImport> {
  const espnPicks = parseFinishedDraft(raw);
  if (!espnPicks) return "not-finished";
  const league = await findLeague(db, userId, leagueId);
  const stored = await getDraft(db, userId, leagueId);
  if (!league || !stored) return "no-league";
  if (stored.state?.picks.length) return "has-picks";

  const result = importedPicks(espnPicks, await crosswalkFor(season), espnTeamId, league.settings);
  if (!result.ok) {
    console.warn(`[espn-season] draft not imported: ${result.reason}`);
    return "mismatch";
  }
  const saved = await putDraft(db, userId, leagueId, { version: DRAFT_STATE_VERSION, picks: result.picks }, stored.revision);
  // A conflict means a save landed first, from a device or live sync: that board wins.
  return saved.status === "ok" ? "imported" : "has-picks";
}

/**
 * The same, for a league already following ESPN whose board is still empty: reads `mDraftDetail`
 * with the stored login. Cheap when there's nothing to do: an empty-board check before any ESPN read.
 */
export async function backfillEspnDraft(db: Db, key: Buffer, userId: string, leagueId: string, deps: DraftImportDeps & { fetchImpl?: typeof fetch } = {}): Promise<DraftImport> {
  const [link, stored] = await Promise.all([findSeasonLink(db, userId, leagueId), getDraft(db, userId, leagueId)]);
  if (!link || !stored) return "no-league";
  if (stored.state?.picks.length) return "has-picks";
  const login = await loadLogin(db, key, userId);
  if (!login) return "no-league";
  const read = await readEspnLeague(login, { season: link.season, espnLeagueId: link.espnLeagueId, views: ["mDraftDetail"] }, { fetchImpl: deps.fetchImpl });
  if (!read.ok) return "not-finished";
  return importEspnDraft(db, userId, leagueId, read.data, { espnTeamId: link.espnTeamId, season: link.season }, deps);
}
