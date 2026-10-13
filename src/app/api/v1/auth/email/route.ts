import { config } from "@/lib/config";
import { redeemEmailToken } from "@/lib/server/appAuth";
import { readAuthRequest, sessionResponse, str } from "@/lib/server/appAuthRoutes";
import { error } from "@/lib/server/http";

/**
 * POST /api/v1/auth/email { email, token } → { token, expiresAt, user, isNew }
 *
 * Redeems a magic link the app opened as a Universal Link: `email` and `token` are the link's own
 * query parameters. Uses up the link exactly as the web would.
 */
export async function POST(request: Request): Promise<Response> {
  const req = await readAuthRequest(request);
  if (!req.ok) return req.response;
  const email = str(req.body.email, 254);
  const token = str(req.body.token, 512);
  if (!email || !token || !config.emailAuthEnabled) return error(400, "email and token are required");
  const signedIn = await redeemEmailToken(req.db, { email, token, secret: config.nextAuthSecret! });
  if (!signedIn) return error(401, "That link has expired or was already used. Send a new one.");
  return sessionResponse(req.db, signedIn.userId, signedIn.isNew);
}
