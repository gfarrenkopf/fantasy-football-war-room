import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatServerError } from "@/lib/server/errorLog";
import { loadSeasonView, loadWeekView } from "@/lib/server/espn/seasonView";
import { error, hasBearer, json } from "@/lib/server/http";
import { runRecapsJob } from "@/lib/server/seasonRecaps";

const ROUTE = "/api/internal/season/recaps";

/**
 * POST /api/internal/season/recaps[?dryRun=1] → RecapsSummary. The Wednesday recap job (APE-308),
 * started by deploy/warroom-season-recaps.timer with `Authorization: Bearer $CRON_SECRET`: keeps and
 * settles every connected league's last week. 404 unless in-season and CRON_SECRET are configured;
 * 401 without the secret.
 */
export async function POST(request: Request): Promise<Response> {
  const { cronSecret, espnCodeKey } = config;
  if (!config.seasonJobEnabled || !cronSecret || !espnCodeKey) return error(404, "Not found");
  if (!hasBearer(request, cronSecret)) return error(401, "Unauthorized");
  const db = getDb();
  try {
    const summary = await runRecapsJob(
      db,
      {
        loadView: (userId, leagueId) => loadSeasonView(db, espnCodeKey, userId, leagueId, { refresh: true }),
        loadWeek: (userId, leagueId, week) => loadWeekView(db, espnCodeKey, userId, leagueId, week, { maxAgeMs: 0 }),
      },
      { dryRun: new URL(request.url).searchParams.get("dryRun") === "1" },
    );
    console.log(`[season-recaps] ${JSON.stringify(summary)}`);
    return json(200, summary);
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(500, "The recap job failed");
  }
}
