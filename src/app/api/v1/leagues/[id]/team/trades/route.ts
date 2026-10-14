import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import type { GuardedOutcome } from "@/lib/server/espn/guardedWrite";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { parseTrade, writeTrade } from "@/lib/server/espn/tradesWrite";
import { consentGate, writeResponse } from "@/lib/server/espn/writeRoute";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { staleAgainst, tradeApplied, tradeDryRun } from "@/lib/server/v1/team";

type Ctx = RouteContext<"/api/v1/leagues/[id]/team/trades">;

const ROUTE = "/api/v1/leagues/[id]/team/trades";

/**
 * POST /api/v1/leagues/:id/team/trades[?dryRun=1]: trades on ESPN for the user's own team from the
 * iPhone app (APE-386, for 19.6). The bodies are the web's season/trades route's:
 *
 * - `{ kind: "propose", week, snapshot, partner, gives, gets, drops, consentVersion? }`
 * - `{ kind: "accept", week, snapshot, tradeId }` / `{ kind: "decline" | "withdraw", week, tradeId }`
 *
 * `?dryRun=1` → TeamDryRun (src/lib/server/v1/team.ts): the trade in plain words and why it can't go
 * to ESPN, checked against the season view. Nothing is written and no consent is needed. Otherwise
 * → TeamApplied: the write is the web's (writeTrade()), answered in plain words with the web's flags.
 *
 * Every refusal answers as the web's ESPN writes do (src/lib/server/espn/writeRoute.ts).
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = seasonGate(email);
  if (gated) return gated;
  const { id } = await ctx.params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parseTrade(read.body);
  if (!body) return error(400, "Invalid trade");
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const key = config.espnCodeKey!;
  const where = { method: request.method, path: new URL(request.url).pathname };
  const alert = (message: string) => console.error(formatServerError(new Error(message), where, { routePath: ROUTE, routeType: "route" }));
  const refuse = (out: GuardedOutcome<never>) => writeResponse(out, { what: "trade", alert, applied: (landed) => landed });

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    if (!dryRun) {
      const gate = await consentGate(db, userId, body.consentVersion);
      if (gate) return gate;
    }

    const load = await loadSeasonView(db, key, userId, id);
    if (load.kind !== "ok") return refuse({ kind: "problem", problem: load.kind });
    const { view } = load;
    if (dryRun) {
      const stale = staleAgainst(view, body.week, body.snapshot);
      return stale ? refuse(stale) : json(200, tradeDryRun(view, body, Date.now()));
    }

    const { what, out } = await writeTrade(db, key, userId, id, body, alert);
    return writeResponse(out, { what, alert, applied: (landed) => json(200, tradeApplied(view, body, landed)) });
  } catch (err) {
    console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Trading on ESPN is temporarily unavailable");
  }
});
