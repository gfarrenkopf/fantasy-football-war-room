import "server-only";
import { getSessionUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { getDb, type Db } from "@/lib/db";
import { bearerToken, userForBearer } from "./appAuth";
import { error, isSameOrigin } from "./http";

/**
 * Wraps an API route handler: 404 when cloud features are off, 401 when signed out, 403 for
 * cross-site writes. The handler gets the database and the session user's id.
 *
 * The web signs in with Auth.js's session cookie; the iPhone app sends the same kind of session
 * token as `Authorization: Bearer <token>` (see appAuth.ts). A request carrying a Bearer token is
 * judged by it alone, never by a cookie. Native requests send no Origin header, so the same-origin
 * check lets them through.
 */
export function withUser<Ctx>(handler: (request: Request, ctx: Ctx, auth: { db: Db; userId: string; email: string | null }) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    if (!config.cloudEnabled) return error(404, "Not found");
    if (request.method !== "GET" && !isSameOrigin(request)) return error(403, "Cross-origin request rejected");
    const token = bearerToken(request);
    const user = token ? await userForBearer(getDb(), token) : await getSessionUser();
    if (!user) return error(401, "Sign in required");
    const response = await handler(request, ctx, { db: getDb(), userId: user.userId, email: user.email });
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}
