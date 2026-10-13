import { authjs } from "@/lib/auth";
import { config } from "@/lib/config";
import { error } from "@/lib/server/http";

/**
 * GET /api/v1/auth/google → redirects into the web's Google sign-in.
 *
 * The app opens this in an ephemeral ASWebAuthenticationSession (Google refuses embedded web
 * views). When Google returns, Auth.js signs that browser in and sends it to /api/v1/auth/handoff,
 * which hands the sign-in to the app.
 */
export async function GET(): Promise<Response> {
  if (!authjs || !config.googleAuthEnabled) return error(404, "Not found");
  // Throws Next's redirect to Google.
  await authjs.signIn("google", { redirectTo: "/api/v1/auth/handoff" });
  return error(500, "Sign-in didn't redirect");
}
