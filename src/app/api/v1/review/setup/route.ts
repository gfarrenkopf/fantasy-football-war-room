import { withUser } from "@/lib/server/api";
import { error, json } from "@/lib/server/http";
import { ensureReviewSetup, isReviewAccount } from "@/lib/server/reviewAccount";

/**
 * POST /api/v1/review/setup → { connected, kept }
 *
 * For App Review's account only (APE-398): connects its ESPN test leagues, as its sign-in does, and
 * says what happened, which sign-in can't. `npm run review:seed` calls it to check the setup before a
 * submission. 404 for every other account; 502 with the reason when it couldn't.
 */
export const POST = withUser<unknown>(async (_request, _ctx, { db, userId, email }) => {
  if (!isReviewAccount(email)) return error(404, "Not found");
  const setup = await ensureReviewSetup(db, userId);
  if (!setup.ok) return error(502, setup.error);
  return json(200, { connected: setup.connected, kept: setup.kept });
});
