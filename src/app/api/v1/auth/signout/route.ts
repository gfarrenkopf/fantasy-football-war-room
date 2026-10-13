import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { bearerToken, deleteAppSession } from "@/lib/server/appAuth";
import { empty, error } from "@/lib/server/http";

/** POST /api/v1/auth/signout (Bearer) → 204. Ends the app's session; signing out twice is fine. */
export async function POST(request: Request): Promise<Response> {
  if (!config.cloudEnabled) return error(404, "Not found");
  const token = bearerToken(request);
  if (!token) return error(401, "Sign in required");
  await deleteAppSession(getDb(), token);
  return empty(204);
}
