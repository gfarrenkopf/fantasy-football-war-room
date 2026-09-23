import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { espnAccess } from "@/lib/server/espn/access";
import { clientFor } from "@/lib/server/espn/clients";
import { getRelay } from "@/lib/server/espn/live";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/espn/autopick">;

/**
 * POST /api/leagues/:id/espn/autopick → 202
 *
 * Turns ESPN's autopick off for the user's team, through War Room's own ESPN connection. ESPN
 * switches autopick on by itself after a turn times out, and while War Room holds the connection the
 * user can't reach ESPN's own toggle. The `autopick` event on the stream confirms it: ESPN answers
 * with `AUTODRAFT <team> false`. Only ever off: War Room never turns autopick on.
 * 409 unless War Room holds the connection.
 */
export const POST = withUser<Ctx>(async (_request, ctx, { db, userId, email }) => {
  if (!config.espnServerClientEnabled) return error(404, "Not found");
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  const access = await espnAccess(db, id, email);
  if (access.kind !== "allowed") return error(access.kind === "needs-purchase" ? 402 : 403, "ESPN live sync isn't available for this league");
  if (!clientFor(userId, id)?.joined() || !getRelay().setAutopick(userId, id, false)) {
    return json(409, { error: "War Room isn't holding your ESPN connection. Turn autopick off in ESPN's Pick Queue panel." });
  }
  return json(202, { ok: true });
});
