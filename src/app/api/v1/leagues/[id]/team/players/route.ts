import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { parsePlayerSearch, playerSearchLimiter } from "@/lib/server/espn/playerSearch";
import { searchPlayers } from "@/lib/server/espn/waivers";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import type { PlayersResponse } from "@/lib/server/v1/team";

type Ctx = RouteContext<"/api/v1/leagues/[id]/team/players">;

const ROUTE = "/api/v1/leagues/[id]/team/players";

/**
 * GET /api/v1/leagues/:id/team/players[?q=&pos=&offset=&refresh=1] → PlayersResponse
 * (src/lib/server/v1/team.ts)
 *
 * The iPhone app's free-agent search (APE-409): the web's season/players read. Add and claim go
 * through team/acquire as a pickup's do. 409 `{ problem }` when ESPN can't be read.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = seasonGate(email);
  if (gated) return gated;
  const { id } = await ctx.params;
  const search = parsePlayerSearch(new URL(request.url));
  if (!search) return error(400, "Invalid search");
  if (!playerSearchLimiter.allow(userId)) return error(429, "Too many searches. Wait a minute and try again.");
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  try {
    const load = await searchPlayers(db, config.espnCodeKey!, userId, id, search);
    if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.problem });
    const body: PlayersResponse = { players: load.players, more: load.more, fetchedAt: load.fetchedAt.toISOString() };
    return json(200, body);
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "ESPN's player pool couldn't be read just now");
  }
});
