import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { reconcileEspnDraft } from "@/lib/server/espn/draftImport";
import { error, json } from "@/lib/server/http";

type Ctx = RouteContext<"/api/leagues/[id]/espn/reconcile">;

/** One ESPN read per league this often, however many times the draft room opens. */
const MIN_INTERVAL_MS = 15_000;
const g = globalThis as { __espnReconciled?: Map<string, number> };

/**
 * POST /api/leagues/:id/espn/reconcile → { result }
 *
 * The draft room opening a league connected to ESPN whose board isn't final (APE-325): if ESPN's
 * draft is over, its picks replace the board and lock it. `result.kind` says what happened:
 * `imported` (read the draft again), `no-login` (ESPN can't be read without connecting the season),
 * `mismatch` (with a `reason`), `not-finished`, `already-final` or `no-league`. A league asked about
 * again within 15 seconds answers `not-finished` without reading ESPN.
 */
export const POST = withUser<Ctx>(async (_request, ctx, { db, userId }) => {
  if (!config.espnSyncEnabled && !config.espnSeasonEnabled) return error(404, "Not found");
  const { id } = await ctx.params;
  if (!config.espnCodeKey) return json(200, { result: { kind: "no-login" } });
  const seen = (g.__espnReconciled ??= new Map());
  const k = `${userId}\u0000${id}`;
  const now = Date.now();
  if (now - (seen.get(k) ?? 0) < MIN_INTERVAL_MS) return json(200, { result: { kind: "not-finished" } });
  if (seen.size > 10_000) seen.clear();
  seen.set(k, now);
  const result = await reconcileEspnDraft(db, config.espnCodeKey, userId, id);
  if (result.kind === "no-league") return error(404, "League not found");
  return json(200, { result });
});
