import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { parseAcquire, writeAcquire } from "@/lib/server/espn/acquireWrite";
import { seasonGate } from "@/lib/server/espn/appEspn";
import type { GuardedOutcome } from "@/lib/server/espn/guardedWrite";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { availablePlayer } from "@/lib/server/espn/waivers";
import { consentGate, writeResponse } from "@/lib/server/espn/writeRoute";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { acquireApplied, acquireDryRun, staleAgainst } from "@/lib/server/v1/team";

type Ctx = RouteContext<"/api/v1/leagues/[id]/team/acquire">;

const ROUTE = "/api/v1/leagues/[id]/team/acquire";

/**
 * POST /api/v1/leagues/:id/team/acquire[?dryRun=1]: adds a free agent, claims a player on waivers, or
 * cancels a claim from the iPhone app (APE-386). The bodies are the web's season/acquire route's:
 *
 * - `{ kind: "add" | "claim", week, snapshot, add, drop, consentVersion? }`
 * - `{ kind: "cancel", week, claimId, consentVersion? }`
 *
 * `?dryRun=1` → TeamDryRun (src/lib/server/v1/team.ts): the change in plain words and why it can't
 * go to ESPN, checked against the season view. Nothing is written and no consent is needed.
 * Otherwise → TeamApplied: the write is the web's (writeAcquire()), answered in plain words with the
 * web's flags. Leagues that bid FAAB can't claim here, as on the web.
 *
 * Every refusal answers as the web's ESPN writes do (src/lib/server/espn/writeRoute.ts).
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = seasonGate(email);
  if (gated) return gated;
  const { id } = await ctx.params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parseAcquire(read.body);
  if (!body) return error(400, "Invalid request");
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const key = config.espnCodeKey!;
  const where = { method: request.method, path: new URL(request.url).pathname };
  const alert = (message: string) => console.error(formatServerError(new Error(message), where, { routePath: ROUTE, routeType: "route" }));
  const refuse = (out: GuardedOutcome<never>) => writeResponse(out, { what: "roster change", alert, applied: (landed) => landed });

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    if (!dryRun) {
      const gate = await consentGate(db, userId, body.consentVersion);
      if (gate) return gate;
    }

    const load = await loadSeasonView(db, key, userId, id);
    if (load.kind !== "ok") return refuse({ kind: "problem", problem: load.kind });
    const { view } = load;
    const pooled = body.kind === "cancel" ? null : await availablePlayer(db, key, userId, id, body.add);
    if (dryRun) {
      const stale = staleAgainst(view, body.week, body.kind === "cancel" ? null : body.snapshot);
      return stale ? refuse(stale) : json(200, acquireDryRun(view, body, pooled));
    }

    const { what, out } = await writeAcquire(db, key, userId, id, body, alert);
    return writeResponse(out, { what, alert, applied: (landed) => json(200, acquireApplied(view, body, landed, pooled)) });
  } catch (err) {
    console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Changing your roster on ESPN is temporarily unavailable");
  }
});
