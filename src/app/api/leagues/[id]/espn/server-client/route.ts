import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { espnAccess } from "@/lib/server/espn/access";
import { handBack, takeOver } from "@/lib/server/espn/clients";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/espn/server-client">;

const REFUSALS = {
  unavailable: [404, "Drafting without an ESPN tab isn't available here"],
  "no-credential": [409, "Run the War Room bookmark in your ESPN draft room and let War Room draft for you first"],
  busy: [503, "War Room is holding too many drafts right now. Draft in ESPN."],
} as const;

/**
 * POST /api/leagues/:id/espn/server-client { action: "take-over" | "hand-back" } → 202 { ok: true }
 *
 * Takes over the user's ESPN draft connection with the join code they handed over (9.1), so War
 * Room drafts for them with no ESPN tab open (9.2), or hands it back. Taking over disconnects the
 * user's own ESPN draft room, so it's only ever this explicit request. How it goes arrives as
 * `serverClient` events on the stream. Gated like the rest of ESPN sync.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  if (!config.espnServerClientEnabled) return error(404, "Not found");
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  const access = await espnAccess(db, id, email);
  if (access.kind === "not-allowed") return error(403, "ESPN live sync isn't available on this account yet");
  if (access.kind === "needs-purchase") return json(402, { needsPurchase: true });

  const read = await readJson(request);
  if (!read.ok) return read.response;
  const action = (read.body as { action?: unknown } | null)?.action;
  if (action === "hand-back") {
    await handBack(db, userId, id);
    return json(202, { ok: true });
  }
  if (action !== "take-over") return error(400, "Invalid action");
  const result = await takeOver(db, userId, id);
  if (!result.ok) {
    const [status, message] = REFUSALS[result.reason];
    return json(status, { error: message, reason: result.reason });
  }
  return json(202, { ok: true });
});
