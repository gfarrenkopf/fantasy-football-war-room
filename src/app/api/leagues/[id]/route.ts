import { withUser } from "@/lib/server/api";
import { empty, error, json, readJson } from "@/lib/server/http";
import { deleteLeague, MAX_LEAGUES_PER_USER, upsertLeague } from "@/lib/server/leagues";
import { parseLeagueRecord } from "@/lib/storage/records";

type Ctx = RouteContext<"/api/leagues/[id]">;

/** PUT /api/leagues/:id with a LeagueRecord → { league, applied } */
export const PUT = withUser<Ctx>(async (request, ctx, { db, userId }) => {
  const { id } = await ctx.params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const record = parseLeagueRecord(read.body);
  if (!record || record.id !== id) return error(400, "Invalid league");

  const result = await upsertLeague(db, userId, record);
  if (result.status === "not-found") return error(404, "League not found");
  if (result.status === "limit") return error(422, `An account can have at most ${MAX_LEAGUES_PER_USER} leagues`);
  return json(200, { league: result.league, applied: result.applied });
});

/** DELETE /api/leagues/:id → 204 */
export const DELETE = withUser<Ctx>(async (_request, ctx, { db, userId }) => {
  const { id } = await ctx.params;
  return (await deleteLeague(db, userId, id)) ? empty(204) : error(404, "League not found");
});
