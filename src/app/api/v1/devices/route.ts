import { withUser } from "@/lib/server/api";
import { bearerToken } from "@/lib/server/appAuth";
import { parseRegistration, registerDevice } from "@/lib/server/devices";
import { empty, error, readJson } from "@/lib/server/http";

/**
 * POST /api/v1/devices { token, environment: "sandbox" | "production", appVersion } → 204
 *
 * Registers the iPhone's APNs device token for pushes, or refreshes it; the app sends it on every
 * launch. Only the app can register, because the token belongs to its Bearer session.
 */
export const POST = withUser(async (request, _ctx, { db, userId }) => {
  const session = bearerToken(request);
  if (!session) return error(400, "Devices are registered by the app");
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const device = parseRegistration(parsed.body);
  if (!device.ok) return error(400, device.error);
  await registerDevice(db, userId, session, device.value);
  return empty(204);
});
