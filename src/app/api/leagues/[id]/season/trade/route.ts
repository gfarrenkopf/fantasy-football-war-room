import type { Trade } from "@/lib/season/trade";
import { withUser } from "@/lib/server/api";
import { seasonAiRequest } from "@/lib/server/ai/season";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json, readJson } from "@/lib/server/http";
import { writeTradeWriteup } from "@/lib/server/seasonAiOutputs";

type Ctx = RouteContext<"/api/leagues/[id]/season/trade">;

const ROUTE = "/api/leagues/[id]/season/trade";

const ids = (x: unknown): number[] | null => (Array.isArray(x) && x.length <= 20 && x.every((v) => Number.isInteger(v)) ? (x as number[]) : null);

/**
 * POST /api/leagues/:id/season/trade { partner, gives, gets } → { writeup, createdAt }: the AI write-up
 * of a trade between the user's team and `partner` (11.2), by ESPN team and player ids. Written now or
 * the one already stored for this trade this week. The verdict it explains is recomputed on the server.
 * 422 for a trade that isn't between two teams of the league, 503 when the model fails.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = (read.body ?? {}) as { partner?: unknown; gives?: unknown; gets?: unknown };
  const gives = ids(body.gives);
  const gets = ids(body.gets);
  if (!Number.isInteger(body.partner) || !gives || !gets) return error(400, "Invalid trade");
  try {
    const req = await seasonAiRequest(db, { userId, email }, id);
    if (req instanceof Response) return req;
    const trade: Trade = { teamA: req.view.myTeamId, gives, teamB: body.partner as number, gets };
    const result = await writeTradeWriteup(db, req.model, { userId, leagueId: id, view: req.view, trade });
    if (result.status === "invalid-trade") return error(422, "That trade isn't between your team and another in this league");
    if (result.status !== "ok") return error(503, "The AI write-up couldn't be written just now. The trade verdict still stands.");
    if (!result.cached) await req.began();
    return json(200, { writeup: result.output, createdAt: result.createdAt });
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "In-season AI is temporarily unavailable");
  }
});
