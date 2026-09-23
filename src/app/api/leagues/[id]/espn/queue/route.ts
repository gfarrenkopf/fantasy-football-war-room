import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { espnAccess } from "@/lib/server/espn/access";
import { clientFor } from "@/lib/server/espn/clients";
import { getRelay } from "@/lib/server/espn/live";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/espn/queue">;

/**
 * POST /api/leagues/:id/espn/queue { sync?: boolean } → 200 { queued }
 *
 * Sets ESPN's pick queue to the war room's turn plan (9.3), through War Room's own ESPN connection.
 * ESPN autopicks from the queue before its own rankings, so it's the safety net if that connection
 * dies while the user is on the clock. It replaces whatever the user queued in ESPN, so it only
 * happens on this request: once, or with `sync`, on every new plan until turned off.
 * 409 unless War Room holds the user's ESPN connection, or before there's a plan to queue.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  if (!config.espnServerClientEnabled) return error(404, "Not found");
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  const access = await espnAccess(db, id, email);
  if (access.kind !== "allowed") return error(access.kind === "needs-purchase" ? 402 : 403, "ESPN live sync isn't available for this league");

  const read = await readJson(request);
  if (!read.ok) return read.response;
  const sync = (read.body as { sync?: unknown } | null)?.sync;
  if (sync !== undefined && typeof sync !== "boolean") return error(400, "Invalid request");
  if (!clientFor(userId, id)?.joined()) return json(409, { error: "War Room isn't holding your ESPN draft connection" });

  const relay = getRelay();
  const ids = sync === undefined ? relay.pushQueue(userId, id) : relay.setQueueSync(userId, id, sync);
  if (sync === false) return json(200, { queued: 0 });
  if (!ids) return json(409, { error: "Your turn plan isn't ready yet. Open your board and try again." });
  return json(200, { queued: ids.length });
});
