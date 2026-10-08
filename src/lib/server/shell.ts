import { config } from "@/lib/config";
import { totalPicks } from "@/lib/draft/snake";
import type { Db } from "@/lib/db/types";
import { espnSettingsPage } from "@/lib/espn/pages";
import { leagueHome } from "@/lib/season/home";
import { loginStatus } from "./espn/logins";
import { mayUseSeason } from "./espn/seasonAccess";
import { listSeasonLinks } from "./espn/seasonLinks";
import { getDraft, listLeagues } from "./leagues";
import { wantsSeasonEmails } from "./seasonPrefs";

/** A league in the app bar's league menu, and where picking it lands. */
export interface ShellLeague {
  id: string;
  name: string;
  /** Linked to an ESPN league this season, so it has a season page. */
  linked: boolean;
  /** The season page when the league is linked and its draft is done; the draft room otherwise. */
  home: string;
  /** The league's settings on ESPN when it's connected to ESPN (APE-325): ESPN owns them, so League settings goes there. */
  espnSettings: string | null;
}

/** The user's ESPN connection, for the account menu: one login reads every league. */
export interface ShellEspn {
  /** Whether the Sunday lineup email goes out; null when there's no such email to offer. */
  seasonEmails: boolean | null;
}

export interface ShellData {
  leagues: ShellLeague[];
  espn: ShellEspn | null;
  /** In-season tools are on for this user, so a league that isn't linked yet can be. */
  season: boolean;
}

/**
 * What the app bar needs on a page for a signed-in user (Epic 15): every league, each with where
 * picking it lands, and the user's ESPN connection when they have one. Season links only count when
 * in-season features are on for this user.
 */
export async function loadShell(db: Db, user: { userId: string; email?: string | null }): Promise<ShellData> {
  const season = config.espnSeasonEnabled && mayUseSeason(config.espnSyncAllowlist, user.email ?? null);
  const [records, links, login] = await Promise.all([
    listLeagues(db, user.userId),
    season ? listSeasonLinks(db, user.userId) : [],
    season ? loginStatus(db, user.userId) : null,
  ]);
  const linkById = new Map(links.map((l) => [l.leagueId, l]));
  const leagues = await Promise.all(
    records.map(async (r) => {
      const link = linkById.get(r.id);
      const linked = !!link;
      // Only a linked league's draft decides anything, so only those are read.
      const draft = linked ? await getDraft(db, user.userId, r.id) : null;
      const done = !!draft?.state && draft.state.picks.length >= totalPicks(r.settings);
      return { id: r.id, name: r.name, linked, home: leagueHome(r.id, linked, done), espnSettings: r.espn ? espnSettingsPage(r.espn) : link ? espnSettingsPage(link) : null };
    }),
  );
  const espn = login
    ? { seasonEmails: config.seasonJobEnabled && config.emailAuthEnabled ? await wantsSeasonEmails(db, user.userId) : null }
    : null;
  return { leagues, espn, season };
}
