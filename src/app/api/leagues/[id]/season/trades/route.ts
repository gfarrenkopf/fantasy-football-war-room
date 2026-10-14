import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { parseTrade, writeTrade } from "@/lib/server/espn/tradesWrite";
import { consentGate, writeResponse } from "@/lib/server/espn/writeRoute";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/season/trades">;

const ROUTE = "/api/leagues/[id]/season/trades";

/**
 * POST /api/leagues/:id/season/trades: trades on ESPN for the user's own team (13.5), each one
 * transaction after re-reading the league, answered from a re-read after writing.
 *
 * - `{ kind: "propose", week, snapshot, partner, gives, gets, drops }` → `{ pending }`.
 * - `{ kind: "accept", week, snapshot, tradeId }` / `{ kind: "decline" | "withdraw", week, tradeId }`
 *   → `{ done }`: accepted (now in review), declined, or withdrawn.
 *
 * Every kind takes `consentVersion?`. Consent, aborts and failures answer as every ESPN write does
 * (src/lib/server/espn/writeRoute.ts); a write that didn't land also logs [server-error].
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parseTrade(read.body);
  if (!body) return error(400, "Invalid trade");
  const where = { method: request.method, path: new URL(request.url).pathname };
  const alert = (message: string) => console.error(formatServerError(new Error(message), where, { routePath: ROUTE, routeType: "route" }));

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    const gate = await consentGate(db, userId, body.consentVersion);
    if (gate) return gate;

    const { what, out } = await writeTrade(db, config.espnCodeKey, userId, id, body, alert);
    return writeResponse(out, { what, alert, applied: (landed) => json(200, landed) });
  } catch (err) {
    console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Trading on ESPN is temporarily unavailable");
  }
});
