import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { users } from "@/lib/db/schema";
import { withUser } from "@/lib/server/api";
import { MIN_APP_VERSION } from "@/lib/server/appLinks";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { json } from "@/lib/server/http";

/**
 * GET /api/v1/me → { user, flags, minAppVersion }
 *
 * Who the app is signed in as, and which features this server offers them. Per-league access
 * (season passes) comes with each league.
 */
export const GET = withUser(async (_request, _ctx, { db, userId, email }) => {
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  return json(200, {
    user,
    flags: {
      season: config.espnSeasonEnabled && mayUseSeason(config.espnSyncAllowlist, email),
      ai: config.aiEnabled,
      payments: config.paymentsEnabled,
    },
    minAppVersion: MIN_APP_VERSION,
  });
});
