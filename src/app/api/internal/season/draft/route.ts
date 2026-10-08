import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getEmailSender } from "@/lib/server/email";
import { formatServerError } from "@/lib/server/errorLog";
import { error, hasBearer, json } from "@/lib/server/http";
import { runDraftDayJob } from "@/lib/server/seasonDraftDay";

const ROUTE = "/api/internal/season/draft";

/**
 * POST /api/internal/season/draft[?dryRun=1] → DraftDaySummary. The draft-day reminder (APE-336),
 * started every 15 minutes by deploy/warroom-season-draft.timer with `Authorization: Bearer
 * $CRON_SECRET`. Does nothing unless a connected league's ESPN draft is 45-60 minutes away. 404
 * unless in-season and CRON_SECRET are configured; 401 without the secret.
 */
export async function POST(request: Request): Promise<Response> {
  const { cronSecret, nextAuthSecret } = config;
  if (!config.seasonJobEnabled || !cronSecret || !nextAuthSecret) return error(404, "Not found");
  if (!hasBearer(request, cronSecret)) return error(401, "Unauthorized");
  try {
    const summary = await runDraftDayJob(
      getDb(),
      { sendEmail: getEmailSender(), baseUrl: config.nextAuthUrl ?? new URL(request.url).origin, secret: nextAuthSecret },
      { dryRun: new URL(request.url).searchParams.get("dryRun") === "1" },
    );
    if (summary.drafts) console.log(`[season-draft] ${JSON.stringify(summary)}`);
    return json(200, summary);
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(500, "The draft-day job failed");
  }
}
