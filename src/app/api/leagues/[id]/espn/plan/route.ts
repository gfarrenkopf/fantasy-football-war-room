import { config } from "@/lib/config";
import { parseOverlayPlan, type OverlayPlayer } from "@/lib/espn/overlayPlan";
import { withUser } from "@/lib/server/api";
import { espnAccess } from "@/lib/server/espn/access";
import { espnIdFor, getRelay } from "@/lib/server/espn/live";
import { empty, error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/espn/plan">;

/**
 * PUT /api/leagues/:id/espn/plan <OverlayPlan> → 204
 *
 * The war room publishing its turn plan for the ESPN overlay (8.14). The server adds each player's
 * ESPN id, so the overlay can draft him, and the bridge picks the plan up on its next check-in.
 * 409 when no bridge is connected to hand it to. Gated like the rest of ESPN sync.
 */
export const PUT = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  if (!config.espnSyncEnabled) return error(404, "Not found");
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  const access = await espnAccess(db, id, email);
  if (access.kind !== "allowed") return error(access.kind === "needs-purchase" ? 402 : 403, "ESPN live sync isn't available for this league");

  const read = await readJson(request);
  if (!read.ok) return read.response;
  const plan = parseOverlayPlan(read.body);
  if (!plan) return error(400, "Invalid plan");

  const relay = getRelay();
  const scope = relay.scope(userId, id);
  if (!scope) return json(409, { error: "No ESPN draft tab is connected" });
  const withIds = async (players: OverlayPlayer[]) =>
    Promise.all(
      players.map(async (p) => {
        const espnPlayerId = await espnIdFor(scope.season, p.playerId).catch(() => null);
        return espnPlayerId === null ? p : { ...p, espnPlayerId };
      }),
    );
  const resolved = { ...plan, targets: await withIds(plan.targets), fallbacks: await withIds(plan.fallbacks), best: await withIds(plan.best) };
  return relay.publishPlan(userId, id, resolved) ? empty(204) : json(409, { error: "No ESPN draft tab is connected" });
});
