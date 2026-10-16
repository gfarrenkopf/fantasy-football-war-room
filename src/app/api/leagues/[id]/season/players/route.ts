import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { parsePlayerSearch, playerSearchLimiter } from "@/lib/server/espn/playerSearch";
import { mayUseSeason } from "@/lib/server/espn/access";
import { searchPlayers } from "@/lib/server/espn/waivers";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/season/players">;

const ROUTE = "/api/leagues/[id]/season/players";

/**
 * GET /api/leagues/:id/season/players[?q=&pos=&offset=&refresh=1] → { players, rostered, more, fetchedAt }:
 * search and browse the league's available players (APE-409), most-rostered first, a page at a time,
 * each valued for the user's best lineup like a pickup, and on a name search's first page the
 * league's rostered players it matches, with their teams (APE-413). 409 `{ problem }` when ESPN can't be read.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!(await mayUseSeason(db, userId, email))) return error(403, "In-season help isn't available on this account yet");
  const search = parsePlayerSearch(new URL(request.url));
  if (!search) return error(400, "Invalid search");
  if (!playerSearchLimiter.allow(userId)) return error(429, "Too many searches. Wait a minute and try again.");
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  try {
    const load = await searchPlayers(db, config.espnCodeKey, userId, id, search);
    if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.problem });
    return json(200, { players: load.players, rostered: load.rostered, more: load.more, fetchedAt: load.fetchedAt.toISOString() });
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "ESPN's player pool couldn't be read just now");
  }
});
