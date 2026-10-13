import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { json } from "@/lib/server/http";

/**
 * GET /api/v1/leagues → { leagues: [{ id, name, espnLeagueId, espnTeamId, season }] }
 *
 * The leagues the iPhone app's switcher shows: the user's leagues connected to ESPN for the season,
 * most recently connected first. v1 of the app is the in-season product, so draft-only leagues
 * aren't listed. Empty when in-season help is off or not open to this account, never an error, so
 * the app shows its empty state rather than a failure.
 */
export const GET = withUser<unknown>(async (_request, _ctx, { db, userId, email }) => {
  if (!config.espnSeasonEnabled || !mayUseSeason(config.espnSyncAllowlist, email)) return json(200, { leagues: [] });
  const links = await listSeasonLinks(db, userId);
  return json(200, {
    leagues: links.map((l) => ({ id: l.leagueId, name: l.name, espnLeagueId: l.espnLeagueId, espnTeamId: l.espnTeamId, season: l.season })),
  });
});
