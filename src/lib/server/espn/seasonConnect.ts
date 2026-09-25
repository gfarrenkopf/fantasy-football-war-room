import { DEFAULT_LEAGUE } from "@/lib/data";
import type { Db } from "@/lib/db/types";
import { ESPN_SEASON_VERSION } from "@/lib/espn/disclosure";
import { toSeasonSettings } from "@/lib/espn/league";
import { ownTeamId, settingsOf } from "@/lib/season/espnLeague";
import { newLeagueRecord } from "@/lib/storage/newLeague";
import { findLeague, upsertLeague } from "../leagues";
import { lastPairedLeague } from "./bridgeTokens";
import { importEspnDraft, type DraftImportDeps } from "./draftImport";
import { readEspnLeague } from "./leagueReader";
import { markVerified, purgeExpiredLogins, storeLogin, type EspnLogin } from "./logins";
import { findSeasonLinkByEspn, linkSeason } from "./seasonLinks";

/**
 * Connecting a season (10.3): the user, from ESPN, hands War Room their login and the ESPN league
 * they're looking at. Checked against ESPN before anything is stored: the login must read the
 * league, and the user must own a team in it. Then the login is stored, and the ESPN league is
 * linked to a war room league: the one already following it, the one last paired with it for the
 * draft, or a new one built from ESPN's settings. A draft ESPN has finished comes onto that league's
 * board if it's empty (APE-193), so the draft room shows the draft that happened.
 */

export interface ConnectRequest extends EspnLogin {
  espnLeagueId: string;
  season: number;
  /** The consent version the user agreed to in the popup. */
  consentVersion: number;
}

export type ConnectResult =
  | { ok: true; leagueId: string; espnTeamId: number; created: boolean }
  | { ok: false; status: number; error: string; seasonVersion?: number };

export async function connectSeason(
  db: Db,
  key: Buffer,
  userId: string,
  req: ConnectRequest,
  { fetchImpl, now = new Date(), crosswalkFor }: { fetchImpl?: typeof fetch; now?: Date } & DraftImportDeps = {},
): Promise<ConnectResult> {
  if (req.consentVersion !== ESPN_SEASON_VERSION) {
    return { ok: false, status: 409, error: "What War Room asks for has changed. Read it again.", seasonVersion: ESPN_SEASON_VERSION };
  }

  const login = { espnS2: req.espnS2, swid: req.swid };
  const read = await readEspnLeague(login, { season: req.season, espnLeagueId: req.espnLeagueId, views: ["mSettings", "mTeam", "mDraftDetail"] }, { fetchImpl });
  if (!read.ok) {
    if (read.reason === "auth") return { ok: false, status: 400, error: "ESPN didn't let War Room read this league. Make sure you're signed in to ESPN, then try again." };
    if (read.reason === "not-found") return { ok: false, status: 404, error: `ESPN has no league ${req.espnLeagueId} for ${req.season}.` };
    return { ok: false, status: 503, error: "Couldn't reach ESPN. Try again in a minute." };
  }
  const espnTeamId = ownTeamId(read.data, req.swid);
  if (espnTeamId === null) return { ok: false, status: 403, error: "You don't have a team in this ESPN league." };

  await purgeExpiredLogins(db, now);
  await storeLogin(db, key, userId, login, { season: req.season, consentVersion: req.consentVersion }, now);
  await markVerified(db, userId, now);

  const link = { espnLeagueId: req.espnLeagueId, espnTeamId, season: req.season };
  const existing = await findSeasonLinkByEspn(db, userId, req.espnLeagueId, req.season);
  const remembered = existing?.leagueId ?? (await lastPairedLeague(db, userId, req.espnLeagueId));
  // Never fails the connect: the board can be filled later (backfillEspnDraft()).
  const withDraft = async (leagueId: string) => {
    try {
      await importEspnDraft(db, userId, leagueId, read.data, { espnTeamId, season: req.season }, { crosswalkFor });
    } catch (err) {
      console.warn(`[espn-season] draft import failed: ${(err as Error).message}`);
    }
  };
  if (remembered && (await findLeague(db, userId, remembered))) {
    await linkSeason(db, userId, { leagueId: remembered, ...link }, now);
    await withDraft(remembered);
    return { ok: true, leagueId: remembered, espnTeamId, created: false };
  }

  const imported = toSeasonSettings(settingsOf(read.data), espnTeamId);
  if (!imported.ok) return { ok: false, status: 422, error: imported.error };
  const record = newLeagueRecord(imported.name ?? `ESPN league ${req.espnLeagueId}`, { ...imported.league, valueThreshold: DEFAULT_LEAGUE.valueThreshold });
  const saved = await upsertLeague(db, userId, record);
  if (saved.status !== "ok") return { ok: false, status: 409, error: "You have too many War Room leagues. Delete one, then try again." };
  await linkSeason(db, userId, { leagueId: record.id, ...link }, now);
  await withDraft(record.id);
  return { ok: true, leagueId: record.id, espnTeamId, created: true };
}
