import { withUser } from "@/lib/server/api";
import { error, json, readJson } from "@/lib/server/http";
import { getDraft, putDraft } from "@/lib/server/leagues";
import { migrateDraftState } from "@/lib/storage/records";

type Ctx = RouteContext<"/api/leagues/[id]/draft">;

/** Far more picks than a real draft; with the body size limit, bounds what one row can hold. */
const MAX_PICKS = 5000;

/** GET /api/leagues/:id/draft → { state: DraftState | null, revision } */
export const GET = withUser<Ctx>(async (_request, ctx, { db, userId }) => {
  const { id } = await ctx.params;
  const draft = await getDraft(db, userId, id);
  return draft ? json(200, draft) : error(404, "League not found");
});

/**
 * PUT /api/leagues/:id/draft with { state, baseRevision }
 * → 200 { revision }, or 409 { state, revision } when baseRevision is stale.
 */
export const PUT = withUser<Ctx>(async (request, ctx, { db, userId }) => {
  const { id } = await ctx.params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const { state: rawState, baseRevision } = (read.body ?? {}) as { state?: unknown; baseRevision?: unknown };
  const state = migrateDraftState(rawState);
  if (!state || state.picks.length > MAX_PICKS) return error(400, "Invalid draft");
  if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0) return error(400, "Invalid baseRevision");

  const result = await putDraft(db, userId, id, state, baseRevision);
  if (result.status === "not-found") return error(404, "League not found");
  if (result.status === "conflict") return json(409, result.current);
  return json(200, { revision: result.revision });
});
