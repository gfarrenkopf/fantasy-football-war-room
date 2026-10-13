import { config } from "@/lib/config";
import { appSiteAssociation } from "@/lib/server/appSiteAssociation";
import { error } from "@/lib/server/http";

/**
 * GET /.well-known/apple-app-site-association: the Universal Links file for the iPhone app. JSON
 * with no extension and no redirect, as Apple requires. 404 without cloud features or the Apple
 * team id (AUTH_APPLE_TEAM_ID, the same developer team that signs in with Apple), so self-hosted
 * copies claim nothing.
 */
export function GET(): Response {
  if (!config.cloudEnabled || !config.appleTeamId) return error(404, "Not found");
  return Response.json(appSiteAssociation(config.appleTeamId), { headers: { "Cache-Control": "public, max-age=3600" } });
}
