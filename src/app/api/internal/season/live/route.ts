import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatServerError } from "@/lib/server/errorLog";
import { getEspnSchedule } from "@/lib/server/espn/schedule";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { error, hasBearer, json } from "@/lib/server/http";
import { runLiveJob } from "@/lib/server/liveActivities";
import { apnsClient } from "@/lib/server/push";

const ROUTE = "/api/internal/season/live";

/** The NFL season a date falls in: it starts in September and runs into February. */
const nflSeason = (now: Date) => (now.getUTCMonth() < 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());

/**
 * POST /api/internal/season/live[?dryRun=1] → LiveSummary. Keeps Game day Live Activities current (21.5),
 * started every minute by deploy/warroom-season-live.timer with `Authorization: Bearer $CRON_SECRET`.
 * It reads leagues through the same cached loader as the app's Game day, so a live league is read
 * from ESPN at most every 45 seconds however many ask. 404 unless in-season, push and CRON_SECRET
 * are configured; 401 without the secret.
 */
export async function POST(request: Request): Promise<Response> {
  const { cronSecret, espnCodeKey } = config;
  if (!config.seasonJobEnabled || !config.pushEnabled || !cronSecret || !espnCodeKey) return error(404, "Not found");
  if (!hasBearer(request, cronSecret)) return error(401, "Unauthorized");
  const db = getDb();
  try {
    const now = new Date();
    const summary = await runLiveJob(db, {
      loadView: (userId, leagueId) => loadSeasonView(db, espnCodeKey, userId, leagueId),
      apns: apnsClient(),
      bundleId: config.apnsBundleId,
      schedule: await getEspnSchedule(nflSeason(now)).catch(() => undefined),
      now,
    }, { dryRun: new URL(request.url).searchParams.get("dryRun") === "1" });
    if (summary.updated || summary.ended || summary.started || summary.failed) console.log(`[season-live] ${JSON.stringify(summary)}`);
    return json(200, summary);
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(500, "The live job failed");
  }
}
