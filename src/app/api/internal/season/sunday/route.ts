import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getPlanModel } from "@/lib/server/ai";
import { getEmailSender } from "@/lib/server/email";
import { formatServerError } from "@/lib/server/errorLog";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { error, json } from "@/lib/server/http";
import { runSundayJob } from "@/lib/server/seasonSunday";

const ROUTE = "/api/internal/season/sunday";

function authorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * POST /api/internal/season/sunday[?dryRun=1] → SundaySummary. The Sunday-morning AI lineup job
 * (11.3), started by deploy/warroom-season-sunday.timer with `Authorization: Bearer $CRON_SECRET`.
 * Runs to completion before answering, so the timer's unit fails if the job does. 404 unless
 * in-season AI and CRON_SECRET are configured; 401 without the secret.
 */
export async function POST(request: Request): Promise<Response> {
  const model = getPlanModel();
  const { cronSecret, espnCodeKey, nextAuthSecret } = config;
  if (!config.seasonJobEnabled || !model || !cronSecret || !espnCodeKey || !nextAuthSecret) return error(404, "Not found");
  if (!authorized(request, cronSecret)) return error(401, "Unauthorized");
  const db = getDb();
  try {
    const summary = await runSundayJob(
      db,
      {
        model,
        // Fresh from ESPN: the point of running now is the inactives just posted.
        loadView: (userId, leagueId) => loadSeasonView(db, espnCodeKey, userId, leagueId, { refresh: true }),
        sendEmail: getEmailSender(),
        paymentsEnabled: config.paymentsEnabled,
        allowlist: config.aiAllowlist,
        baseUrl: config.nextAuthUrl ?? new URL(request.url).origin,
        secret: nextAuthSecret,
      },
      { dryRun: new URL(request.url).searchParams.get("dryRun") === "1" },
    );
    console.log(`[season-sunday] ${JSON.stringify(summary)}`);
    return json(200, summary);
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(500, "The Sunday job failed");
  }
}
