import { redeemHandoffCode } from "@/lib/server/appAuth";
import { readAuthRequest, sessionResponse, str } from "@/lib/server/appAuthRoutes";
import { error } from "@/lib/server/http";

/**
 * POST /api/v1/auth/code { code } → { token, expiresAt, user, isNew }
 *
 * Trades the one-time code from /api/v1/auth/handoff (the end of Google sign-in in the system
 * browser) for an app session. A code works once, within 60 seconds.
 */
export async function POST(request: Request): Promise<Response> {
  const req = await readAuthRequest(request);
  if (!req.ok) return req.response;
  const code = str(req.body.code, 256);
  if (!code) return error(400, "code is required");
  const userId = await redeemHandoffCode(req.db, code);
  if (!userId) return error(401, "That sign-in has expired. Try again.");
  return sessionResponse(req.db, userId, false);
}
