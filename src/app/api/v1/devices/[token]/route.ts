import { withUser } from "@/lib/server/api";
import { removeDevice } from "@/lib/server/devices";
import { empty } from "@/lib/server/http";

/** DELETE /api/v1/devices/[token] → 204. Stops pushes to that device; deleting twice is fine. */
export const DELETE = withUser(async (_request, ctx: { params: Promise<{ token: string }> }, { db, userId }) => {
  const { token } = await ctx.params;
  await removeDevice(db, userId, token);
  return empty(204);
});
