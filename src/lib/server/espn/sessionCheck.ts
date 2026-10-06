import "server-only";
import type { Db } from "@/lib/db/types";
import { readEspnLeague } from "./leagueReader";
import { markDisconnected, markVerified, type EspnLogin } from "./logins";

/**
 * One login covers all of a user's leagues, so disconnecting it signs every one of them out until the
 * user uses the bookmark again. That's right when ESPN has ended the session (they signed out,
 * changed their password, or it expired), but a single 401 or 403 can also be ESPN's edge having a
 * moment, or a write ESPN refuses with a 403. So a refusal is confirmed first, with a light read of
 * the same league (APE-244).
 */

export type SessionCheck = (db: Db, userId: string, login: EspnLogin, league: { season: number; espnLeagueId: string }) => Promise<boolean>;

/** ESPN refused the login once: reads the league again, and disconnects the login only if ESPN refuses that too. Returns whether it did. */
export function createSessionCheck({ fetchImpl, now = () => new Date() }: { fetchImpl?: typeof fetch; now?: () => Date } = {}): SessionCheck {
  return async (db, userId, login, league) => {
    const read = await readEspnLeague(login, { ...league, views: ["mSettings"] }, { fetchImpl });
    if (!read.ok && read.reason === "auth") {
      await markDisconnected(db, userId, now());
      return true;
    }
    if (read.ok) await markVerified(db, userId, now());
    else console.warn(`[espn-season] couldn't confirm an ESPN refusal, keeping the login: ${read.detail}`);
    return false;
  };
}

export const confirmSignedOut = createSessionCheck();
