import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { deleteLogin, loginStatus } from "@/lib/server/espn/logins";
import { empty, json } from "@/lib/server/http";

/**
 * GET /api/v1/espn/login → { login: { status, season, verifiedAt } | null }
 * DELETE /api/v1/espn/login → 204
 *
 * The app's "ESPN connection" in settings: the stored login's status (never the login itself), and
 * disconnecting, which deletes it. The v1 copy of /api/espn/login.
 */
export const GET = withUser<unknown>(async (_request, _ctx, { db, userId, email }) => {
  const gated = seasonGate(email);
  if (gated) return gated;
  return json(200, { login: await loginStatus(db, userId) });
});

export const DELETE = withUser<unknown>(async (_request, _ctx, { db, userId, email }) => {
  const gated = seasonGate(email);
  if (gated) return gated;
  await deleteLogin(db, userId);
  return empty(204);
});
