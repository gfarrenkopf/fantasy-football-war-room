import { config } from "@/lib/config";
import { ESPN_WRITE_DISCLOSURE, ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { afterSeasonRead, seasonExtras } from "@/lib/server/espn/seasonVisit";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { seasonResponse } from "@/lib/server/v1/season";

type Ctx = RouteContext<"/api/v1/leagues/[id]/season">;

const ROUTE = "/api/v1/leagues/[id]/season";

/** What to tell the user when ESPN can't be read, by the season load's problem. */
const PROBLEM: Record<string, string> = {
  "not-linked": "This league isn't connected to ESPN.",
  "no-login": "Draft Room needs your ESPN connection again.",
  disconnected: "ESPN signed Draft Room out. Reconnect ESPN to see this league.",
  unavailable: "Couldn't reach ESPN. Try again in a minute.",
  invalid: "ESPN sent something Draft Room couldn't read.",
};

/**
 * GET /api/v1/leagues/:id/season[?refresh=1] → SeasonResponse (src/lib/server/v1/season.ts)
 *
 * The iPhone app's Game day and Lineup tabs (APE-379): what the season page shows, with every value
 * the page derives in its components already derived. Gated like the page. A visit does what the
 * page's does: it keeps ESPN's projections and the recap archive, and marks the league viewed. 409
 * `{ problem }` when ESPN can't be read; `refresh=1` skips the cache, for pull-to-refresh.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const { id } = await ctx.params;
  const league = await findLeague(db, userId, id);
  if (!league) return error(404, "League not found");
  const key = config.espnCodeKey!;
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const load = await loadSeasonView(db, key, userId, id, { refresh });
    afterSeasonRead(db, key, userId, id, load);
    if (load.kind !== "ok") return json(409, { error: PROBLEM[load.kind], problem: load.kind });
    const extras = await seasonExtras(db, userId, id, load);
    return json(
      200,
      seasonResponse({
        league: { id, name: league.name },
        view: load.view,
        result: load.result,
        previous: load.previous,
        phase: load.phase,
        fetchedAt: load.fetchedAt,
        stale: load.stale,
        projectionsMissing: load.projectionsMissing,
        accuracy: extras.accuracy,
        previousAccuracy: extras.previousAccuracy,
        kept: extras.kept,
        consent: { version: ESPN_WRITE_VERSION, lines: ESPN_WRITE_DISCLOSURE, consented: extras.consented },
      }),
    );
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Your season couldn't be read just now");
  }
});
