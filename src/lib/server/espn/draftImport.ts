import "server-only";
import { dataset } from "@/lib/data";
import type { Db } from "@/lib/db/types";
import { DRAFT_STATE_VERSION } from "@/lib/draft/state";
import { totalPicks } from "@/lib/draft/snake";
import type { DraftPick } from "@/lib/draft/types";
import { buildCrosswalk, type Crosswalk } from "@/lib/espn/crosswalk";
import { importedPicks, parseFinishedDraft } from "@/lib/espn/draftImport";
import type { LiveSnapshot } from "@/lib/espn/live";
import { syncMode, toDraftPicks } from "@/lib/espn/sync";
import { findLeague, getDraft, putDraft } from "../leagues";
import { readEspnLeague } from "./leagueReader";
import { loadLogin } from "./logins";
import { getEspnPlayers } from "./players";
import { findSeasonLink } from "./seasonLinks";

/**
 * A connected league's board, made ESPN's finished draft and locked (APE-193, APE-325). ESPN is the
 * source of truth for a connected league, so its draft replaces whatever the board holds, picks
 * logged by hand included, and the board is marked `final`: read-only from then on.
 *
 * The truth comes from ESPN's `mDraftDetail`, read with the user's stored login, or else from the
 * live feed, when it saw the whole draft. With neither, nothing is locked: the board stays the
 * user's until they connect ESPN for the season.
 */

export type DraftImport =
  | { kind: "imported" }
  /** The board is already final. */
  | { kind: "already-final" }
  /** ESPN's draft isn't over, or couldn't be read. */
  | { kind: "not-finished" }
  /** No stored ESPN login to read the draft with. */
  | { kind: "no-login" }
  /** ESPN's draft doesn't fit this league's board. */
  | { kind: "mismatch"; reason: string }
  | { kind: "no-league" };

export interface DraftImportDeps {
  crosswalkFor?: (season: number) => Promise<Crosswalk>;
  now?: Date;
}

const defaultCrosswalk = async (season: number) => buildCrosswalk(await getEspnPlayers(season), dataset.players);

/** Writes `picks` as the league's final board. Retries a race with another save; the board stays ESPN's either way. */
async function writeFinal(db: Db, userId: string, leagueId: string, picks: DraftPick[], now: Date): Promise<DraftImport> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await getDraft(db, userId, leagueId);
    if (!stored) return { kind: "no-league" };
    if (stored.state?.final) return { kind: "already-final" };
    const saved = await putDraft(db, userId, leagueId, { version: DRAFT_STATE_VERSION, picks, final: { source: "espn", at: now.toISOString() } }, stored.revision, { server: true });
    if (saved.status === "ok") return { kind: "imported" };
    if (saved.status === "not-found") return { kind: "no-league" };
  }
  return { kind: "not-finished" };
}

/** Makes the finished draft in `raw` (ESPN's league document with `mDraftDetail`) the league's final board. */
export async function importEspnDraft(
  db: Db,
  userId: string,
  leagueId: string,
  raw: unknown,
  { espnTeamId, season }: { espnTeamId: number; season: number },
  { crosswalkFor = defaultCrosswalk, now = new Date() }: DraftImportDeps = {},
): Promise<DraftImport> {
  const espnPicks = parseFinishedDraft(raw);
  if (!espnPicks) return { kind: "not-finished" };
  const [league, stored] = await Promise.all([findLeague(db, userId, leagueId), getDraft(db, userId, leagueId)]);
  if (!league || !stored) return { kind: "no-league" };
  if (stored.state?.final) return { kind: "already-final" };

  const result = importedPicks(espnPicks, await crosswalkFor(season), espnTeamId, league.settings);
  if (!result.ok) {
    console.warn(`[espn-season] draft not imported: ${result.reason}`);
    return { kind: "mismatch", reason: result.reason };
  }
  return writeFinal(db, userId, leagueId, result.picks, now);
}

/**
 * The same for a connected league that isn't final yet, reading `mDraftDetail` with the stored
 * login. Cheap when there's nothing to do: the final check comes before any ESPN read.
 */
export async function reconcileEspnDraft(
  db: Db,
  key: Buffer,
  userId: string,
  leagueId: string,
  deps: DraftImportDeps & { fetchImpl?: typeof fetch } = {},
): Promise<DraftImport> {
  const [league, link, stored] = await Promise.all([findLeague(db, userId, leagueId), findSeasonLink(db, userId, leagueId), getDraft(db, userId, leagueId)]);
  const espn = league?.espn ?? link;
  if (!espn || !stored) return { kind: "no-league" };
  if (stored.state?.final) return { kind: "already-final" };
  const login = await loadLogin(db, key, userId);
  if (!login) return { kind: "no-login" };
  const read = await readEspnLeague(login, { season: espn.season, espnLeagueId: espn.espnLeagueId, views: ["mDraftDetail"] }, { fetchImpl: deps.fetchImpl });
  if (!read.ok) return { kind: "not-finished" };
  return importEspnDraft(db, userId, leagueId, read.data, { espnTeamId: espn.espnTeamId, season: espn.season }, deps);
}

/**
 * The live feed's draft as the league's final board, when the feed can vouch for it: it saw the
 * whole draft from the first pick (anchored), read every frame, and has every pick of the board.
 */
export async function finalizeFromLive(db: Db, userId: string, leagueId: string, live: LiveSnapshot, { now = new Date() }: { now?: Date } = {}): Promise<DraftImport> {
  if (live.draft !== "complete") return { kind: "not-finished" };
  const league = await findLeague(db, userId, leagueId);
  if (!league) return { kind: "no-league" };
  const total = totalPicks(league.settings);
  if (syncMode(live) !== "replace") return { kind: "not-finished" };
  if (live.picks.length !== total) return { kind: "mismatch", reason: `ESPN's draft has ${live.picks.length} picks; this league's board has ${total}` };
  return writeFinal(db, userId, leagueId, toDraftPicks(live.picks), now);
}

/**
 * ESPN said the draft is over (the relay's `onComplete`): the board becomes ESPN's, from
 * `mDraftDetail` when there's a login (ESPN may not have it ready for a moment), else the feed.
 */
export async function finalizeCompletedDraft(db: Db, key: Buffer | null, userId: string, leagueId: string, live: LiveSnapshot, deps: DraftImportDeps & { fetchImpl?: typeof fetch } = {}): Promise<DraftImport> {
  if (key) {
    const read = await reconcileEspnDraft(db, key, userId, leagueId, deps);
    if (read.kind === "imported" || read.kind === "already-final" || read.kind === "no-league") return read;
  }
  return finalizeFromLive(db, userId, leagueId, live, deps);
}
