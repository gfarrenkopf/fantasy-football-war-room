import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { deleteLogin, loginStatus } from "@/lib/server/espn/logins";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { empty, error, json } from "@/lib/server/http";

/**
 * GET /api/espn/login → { login: { status, season, verifiedAt } | null }
 * DELETE /api/espn/login → 204
 *
 * The user's stored ESPN login for the season (10.2): whether War Room has one and whether ESPN still
 * accepts it, and disconnecting, which deletes it. The login itself is never returned. 404 when
 * in-season features are off.
 */
export const GET = withUser<unknown>(async (_request, _ctx, { db, userId, email }) => {
  if (!config.espnSeasonEnabled || !mayUseSeason(config.espnSyncAllowlist, email)) return error(404, "Not found");
  return json(200, { login: await loginStatus(db, userId) });
});

export const DELETE = withUser<unknown>(async (_request, _ctx, { db, userId, email }) => {
  if (!config.espnSeasonEnabled || !mayUseSeason(config.espnSyncAllowlist, email)) return error(404, "Not found");
  await deleteLogin(db, userId);
  return empty(204);
});
