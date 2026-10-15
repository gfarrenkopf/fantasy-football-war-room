import { withUser } from "@/lib/server/api";
import { empty } from "@/lib/server/http";
import { removeLiveActivity } from "@/lib/server/liveActivities";

/** DELETE /api/v1/leagues/:id/live-activity/:token → 204. The user ended the activity; deleting twice is fine. */
export const DELETE = withUser<RouteContext<"/api/v1/leagues/[id]/live-activity/[token]">>(async (_request, ctx, { db, userId }) => {
  const { token } = await ctx.params;
  await removeLiveActivity(db, userId, token);
  return empty(204);
});
