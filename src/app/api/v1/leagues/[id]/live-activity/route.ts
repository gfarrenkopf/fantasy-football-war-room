import { withUser } from "@/lib/server/api";
import { bearerToken } from "@/lib/server/appAuth";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { parseRegistration } from "@/lib/server/devices";
import { empty, error, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { registerLiveActivity } from "@/lib/server/liveActivities";

type Ctx = RouteContext<"/api/v1/leagues/[id]/live-activity">;

/**
 * POST /api/v1/leagues/:id/live-activity { token, environment, week } → 204
 *
 * Registers a Game day Live Activity's APNs update token (21.5), so the live job keeps it current.
 * The app sends it when it starts one ("Follow live"), and again when push-to-start started one or
 * iOS hands it a new token. Only the app can register, because the token belongs to its session.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const session = bearerToken(request);
  if (!session) return error(400, "Live Activities are registered by the app");
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const week = (read.body as { week?: unknown } | null)?.week;
  const parsed = parseRegistration(read.body);
  if (!parsed.ok) return error(400, parsed.error);
  if (typeof week !== "number" || !Number.isInteger(week) || week < 1) return error(400, "week must be the NFL week the activity follows");
  await registerLiveActivity(db, { userId, sessionToken: session, leagueId: id, token: parsed.value.token, environment: parsed.value.environment, week });
  return empty(204);
});
