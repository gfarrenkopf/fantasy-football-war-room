import "server-only";
import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb, type Db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createAppSession } from "./appAuth";
import { error, isSameOrigin, json, readJson } from "./http";
import { clientIp, rateLimiter } from "./rateLimit";

/**
 * Shared plumbing for the app's sign-in routes under /api/v1/auth (APE-372). They run before
 * anyone is signed in, so they can't use withUser(); this gives them its 404-when-cloud-is-off and
 * same-origin rules, plus a per-address rate limit, since each one checks a secret.
 */

/** Ten attempts a minute per address: plenty for a person, slow for guessing. */
const limiter = rateLimiter({ limit: 10, windowMs: 60_000 });

export async function readAuthRequest(request: Request): Promise<{ ok: true; db: Db; body: Record<string, unknown> } | { ok: false; response: Response }> {
  if (!config.cloudEnabled) return { ok: false, response: error(404, "Not found") };
  if (!isSameOrigin(request)) return { ok: false, response: error(403, "Cross-origin request rejected") };
  if (!limiter.allow(clientIp(request))) return { ok: false, response: error(429, "Too many attempts. Wait a minute and try again.") };
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (typeof parsed.body !== "object" || parsed.body === null || Array.isArray(parsed.body)) return { ok: false, response: error(400, "Expected a JSON object") };
  return { ok: true, db: getDb(), body: parsed.body as Record<string, unknown> };
}

export const str = (value: unknown, max = 4096): string | null => (typeof value === "string" && value.length > 0 && value.length <= max ? value : null);

/** The app's session for a signed-in user: `{ token, expiresAt, user }`. Never logged. */
export async function sessionResponse(db: Db, userId: string, isNew: boolean): Promise<Response> {
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  const { token, expiresAt } = await createAppSession(db, userId);
  const response = json(200, { token, expiresAt: expiresAt.toISOString(), user, isNew });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
