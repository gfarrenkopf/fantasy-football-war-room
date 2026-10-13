import { authjs, getSessionUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { createHandoffCode } from "@/lib/server/appAuth";
import { APP_CALLBACK_PATH, APP_SCHEME } from "@/lib/server/appLinks";
import { error } from "@/lib/server/http";

/**
 * GET /api/v1/auth/handoff → redirects to the app with a one-time code.
 *
 * The end of Google sign-in for the app: the system browser now holds a web session. That session
 * becomes a 60-second, single-use code (POST /api/v1/auth/code trades it for the app's own session)
 * and is then signed out, so nothing lingers in the browser.
 *
 * In production the code goes to a Universal Link on this domain, which only the Draft Room app can
 * claim; a custom URL scheme could be claimed by any app. Development servers have no Universal
 * Links, so they use the app's scheme.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authjs || !config.cloudEnabled) return error(404, "Not found");
  const user = await getSessionUser();
  if (!user) return Response.redirect(new URL("/draft?error=AccessDenied", request.url), 302);
  const code = await createHandoffCode(getDb(), user.userId);
  await authjs.signOut({ redirect: false });
  const target = config.isProduction
    ? new URL(`${APP_CALLBACK_PATH}?code=${encodeURIComponent(code)}`, config.nextAuthUrl ?? request.url)
    : `${APP_SCHEME}://auth/callback?code=${encodeURIComponent(code)}`;
  const response = new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
  return response;
}
