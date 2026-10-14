import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { listKeptWeeks } from "@/lib/server/seasonRecaps";
import { recapsResponse } from "@/lib/server/v1/recaps";

type Ctx = RouteContext<"/api/v1/leagues/[id]/recaps">;

/**
 * GET /api/v1/leagues/:id/recaps → RecapsResponse (src/lib/server/v1/recaps.ts)
 *
 * The iPhone app's recap archive (APE-383): every week of the league kept so far, newest first,
 * each with its headline, the user's result and when it was kept. Read from the database only; the
 * season route's visits and the Wednesday job keep the weeks. Gated like the season route.
 */
export const GET = withUser<Ctx>(async (_request, ctx, { db, userId, email }) => {
  const gated = seasonGate(email);
  if (gated) return gated;
  const { id } = await ctx.params;
  const league = await findLeague(db, userId, id);
  if (!league) return error(404, "League not found");
  return json(200, recapsResponse({ id, name: league.name }, await listKeptWeeks(db, id)));
});
