import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { empty, error } from "@/lib/server/http";
import { setSeasonEmails, verifyUnsubscribeToken } from "@/lib/server/seasonPrefs";

/**
 * POST /api/season/unsubscribe?u=<user id>&t=<token> turns off the Sunday job's emails (11.3). No
 * session needed: the token (seasonPrefs.ts) is the proof, and it can only turn emails off. Mail
 * providers call it for one-click unsubscribe (RFC 8058); the /season/unsubscribe page's form posts
 * here too and is sent back to that page. 204 for providers, 400 for a bad link, 404 when cloud is off.
 */
export async function POST(request: Request): Promise<Response> {
  if (!config.cloudEnabled || !config.nextAuthSecret) return error(404, "Not found");
  const url = new URL(request.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!userId || !verifyUnsubscribeToken(config.nextAuthSecret, userId, token)) return error(400, "This unsubscribe link isn't valid");
  // A foreign key: an account deleted since the email went out has nothing left to turn off.
  await setSeasonEmails(getDb(), userId, false).catch(() => {});
  if (url.searchParams.get("from") === "page") return Response.redirect(new URL("/season/unsubscribe?done=1", config.nextAuthUrl ?? url.origin), 303);
  return empty(204);
}
