import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { espnAccess } from "@/lib/server/espn/access";
import { espnIdFor, getRelay } from "@/lib/server/espn/live";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/espn/pick">;

const REFUSALS = {
  "no-bridge": [409, "Connect your ESPN draft tab first"],
  "bridge-offline": [409, "Your ESPN draft tab isn't connected right now"],
  "not-your-turn": [409, "ESPN doesn't have you on the clock"],
  taken: [409, "That player is already drafted"],
  busy: [409, "Your last pick is still on its way to ESPN"],
} as const;

/**
 * POST /api/leagues/:id/espn/pick { playerId } → 202 { request }
 *
 * The user drafting a player from War Room during a live ESPN draft (8.13). The relay hands the
 * pick to the league's bridge on its next check-in, and the bridge makes it on ESPN's own socket;
 * `request` events on the stream say how it went. 409 with a reason when it can't be made now,
 * 422 for a player ESPN can't be matched to. Gated like the rest of ESPN sync.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  if (!config.espnSyncEnabled) return error(404, "Not found");
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  const access = await espnAccess(db, id, email);
  if (access.kind === "not-allowed") return error(403, "ESPN live sync isn't available on this account yet");
  if (access.kind === "needs-purchase") return json(402, { needsPurchase: true });

  const read = await readJson(request);
  if (!read.ok) return read.response;
  const playerId = (read.body as { playerId?: unknown } | null)?.playerId;
  if (typeof playerId !== "string" || !playerId || playerId.length > 120) return error(400, "Invalid player");

  const relay = getRelay();
  const scope = relay.scope(userId, id);
  if (!scope) return json(409, { error: REFUSALS["no-bridge"][1], reason: "no-bridge" });
  const espnPlayerId = await espnIdFor(scope.season, playerId).catch(() => null);
  if (espnPlayerId === null) return error(422, "Can't find that player in ESPN's player list. Pick him in ESPN.");

  const result = relay.requestPick(userId, id, { playerId, espnPlayerId });
  if (!result.ok) {
    const [status, message] = REFUSALS[result.reason];
    return json(status, { error: message, reason: result.reason });
  }
  return json(202, { request: result.request });
});
