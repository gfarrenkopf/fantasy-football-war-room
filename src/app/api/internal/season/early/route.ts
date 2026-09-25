import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getEmailSender } from "@/lib/server/email";
import { formatServerError } from "@/lib/server/errorLog";
import { getEspnSchedule } from "@/lib/server/espn/schedule";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { error, hasBearer, json } from "@/lib/server/http";
import { runEarlyJob } from "@/lib/server/seasonEarly";

const ROUTE = "/api/internal/season/early";

/** The NFL season a date falls in: it starts in September and runs into February. */
const nflSeason = (now: Date) => (now.getUTCMonth() < 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());

/**
 * POST /api/internal/season/early[?dryRun=1] → EarlySummary. The early-kickoff alert (11.4), started
 * every 15 minutes by deploy/warroom-season-early.timer with `Authorization: Bearer $CRON_SECRET`.
 * Does nothing unless an early kickoff is 60-75 minutes away. 404 unless in-season and CRON_SECRET
 * are configured; 401 without the secret.
 */
export async function POST(request: Request): Promise<Response> {
  const { cronSecret, espnCodeKey, nextAuthSecret } = config;
  if (!config.seasonJobEnabled || !cronSecret || !espnCodeKey || !nextAuthSecret) return error(404, "Not found");
  if (!hasBearer(request, cronSecret)) return error(401, "Unauthorized");
  const db = getDb();
  try {
    const now = new Date();
    const summary = await runEarlyJob(
      db,
      {
        schedule: await getEspnSchedule(nflSeason(now)),
        loadView: (userId, leagueId) => loadSeasonView(db, espnCodeKey, userId, leagueId, { refresh: true }),
        sendEmail: getEmailSender(),
        baseUrl: config.nextAuthUrl ?? new URL(request.url).origin,
        secret: nextAuthSecret,
        now,
      },
      { dryRun: new URL(request.url).searchParams.get("dryRun") === "1" },
    );
    if (summary.kickoff) console.log(`[season-early] ${JSON.stringify(summary)}`);
    return json(200, summary);
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(500, "The early-kickoff job failed");
  }
}
