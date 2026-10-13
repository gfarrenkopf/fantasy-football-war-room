import { AuthError } from "next-auth";
import { authjs } from "@/lib/auth";
import { config } from "@/lib/config";
import { readAuthRequest, str } from "@/lib/server/appAuthRoutes";
import { APP_SIGNED_IN_PATH } from "@/lib/server/appLinks";
import { empty, error } from "@/lib/server/http";

/**
 * POST /api/v1/auth/email/start { email } → 204
 *
 * Sends a magic link for the app. It's the web's link with the app's landing page as its
 * destination, which is what the Universal Link rule matches on (/.well-known/apple-app-site-association),
 * so only links asked for in the app open the app. Like the web form, the answer never says
 * whether the address has an account.
 */
export async function POST(request: Request): Promise<Response> {
  const req = await readAuthRequest(request);
  if (!req.ok) return req.response;
  if (!authjs || !config.emailAuthEnabled) return error(404, "Email sign-in isn't set up on this server");
  const email = str(req.body.email, 254)?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(400, "That doesn't look like an email address.");
  try {
    await authjs.signIn("resend", { email, redirect: false, redirectTo: APP_SIGNED_IN_PATH });
  } catch (e) {
    if (e instanceof AuthError) return error(502, "Couldn't send the link. Try again in a moment.");
    throw e;
  }
  return empty(204);
}
