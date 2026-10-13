import { withUser } from "@/lib/server/api";
import { deleteAccount } from "@/lib/server/account";
import { empty, error, readJson } from "@/lib/server/http";

/**
 * DELETE /api/v1/account { confirm: "DELETE" } → 204
 *
 * Deletes the signed-in account and everything it owns (see deleteAccount()). The body has to
 * say so, so a stray request can't do it. Used by the iPhone app's settings and the web's account menu.
 */
export const DELETE = withUser(async (request, _ctx, { db, userId }) => {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if ((parsed.body as { confirm?: unknown } | null)?.confirm !== "DELETE") return error(400, 'Send { "confirm": "DELETE" } to delete the account');
  await deleteAccount(db, userId);
  return empty(204);
});
