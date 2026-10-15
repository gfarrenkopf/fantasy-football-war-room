import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { empty, error } from "@/lib/server/http";
import { isAlertKind } from "@/lib/season/alerts";
import { unsubscribe, verifyUnsubscribeToken } from "@/lib/server/seasonPrefs";

/**
 * POST /api/season/unsubscribe?u=<user id>&t=<token>[&k=<alert>] turns off one season alert's email
 * (21.3), or every season email for a link from before alerts had their own settings (11.3). No
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
  const kind = url.searchParams.get("k");
  // A foreign key: an account deleted since the email went out has nothing left to turn off.
  await unsubscribe(getDb(), userId, isAlertKind(kind) ? kind : null).catch(() => {});
  if (url.searchParams.get("from") === "page") {
    const done = new URL("/season/unsubscribe?done=1", config.nextAuthUrl ?? url.origin);
    if (isAlertKind(kind)) done.searchParams.set("k", kind);
    return Response.redirect(done, 303);
  }
  return empty(204);
}
