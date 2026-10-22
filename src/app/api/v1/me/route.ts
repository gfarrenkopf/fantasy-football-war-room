import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { users } from "@/lib/db/schema";
import { withUser } from "@/lib/server/api";
import { MIN_APP_VERSION } from "@/lib/server/appLinks";
import { mayUseSeason } from "@/lib/server/espn/access";
import { json } from "@/lib/server/http";
import { isReviewAccount } from "@/lib/server/reviewAccount";

/**
 * GET /api/v1/me → { user, flags, minAppVersion, review? }
 *
 * Who the app is signed in as, and which features this server offers them. Per-league access
 * (season passes) comes with each league. `review` is set only for App Review's account (APE-398),
 * which gets Settings rows that send a sample alert and Live Activity.
 */
export const GET = withUser(async (_request, _ctx, { db, userId, email }) => {
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  return json(200, {
    user,
    flags: {
      season: config.espnSeasonEnabled && (await mayUseSeason(db, userId, email)),
      ai: config.aiEnabled,
      payments: config.paymentsEnabled,
    },
    minAppVersion: MIN_APP_VERSION,
    ...(isReviewAccount(email) ? { review: true } : {}),
  });
});
