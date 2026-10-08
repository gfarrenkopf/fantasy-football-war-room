import type { Db } from "@/lib/db/types";
import { draftAtOf, nameOf, parseEspnSettings, toLeagueSettings, toSeasonSettings } from "@/lib/espn/league";
import { settingsOf } from "@/lib/season/espnLeague";
import type { EspnConnection } from "@/lib/storage/types";
import { connectEspn, findLeague, getDraft } from "../leagues";

/**
 * A connected league following ESPN's settings and name as they change (APE-325, APE-330): read
 * from any ESPN league document that carries `mSettings`, such as the season loader's. A draft
 * that's final keeps the board's shape, since its picks are seated by it: only scoring and the name
 * follow. A draft order ESPN no longer shows leaves the league's own slot, not slot 1. Until the
 * draft starts, so does ESPN's draft time (APE-336). False when the user has no such league.
 */
export async function followEspnSettings(db: Db, userId: string, leagueId: string, raw: unknown, espn: EspnConnection, now = new Date()): Promise<boolean> {
  const row = await findLeague(db, userId, leagueId);
  if (!row) return false;
  const espnSettings = parseEspnSettings(settingsOf(raw));
  const name = espnSettings ? nameOf(espnSettings) : undefined;
  const draft = (await getDraft(db, userId, leagueId))?.state;
  // When ESPN has the draft, until it starts (APE-336): for the draft-day reminder, and the board's countdown.
  const draftAt = !draft?.picks.length && !draft?.final && espnSettings ? (draftAtOf(espnSettings) ?? undefined) : undefined;
  const imported = toSeasonSettings(settingsOf(raw), espn.espnTeamId);
  if (!imported.ok) return connectEspn(db, userId, leagueId, espn, { name, draftAt }, now);

  const final = draft?.final;
  const order = toLeagueSettings(settingsOf(raw), espn.espnTeamId);
  const settings = final
    ? { teams: row.settings.teams, mySlot: row.settings.mySlot, roster: row.settings.roster, scoring: imported.league.scoring }
    : { ...imported.league, mySlot: order.ok ? order.league.mySlot : row.settings.mySlot };
  return connectEspn(db, userId, leagueId, espn, { settings, name, draftAt }, now);
}
