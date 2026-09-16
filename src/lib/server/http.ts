/**
 * Request helpers for the JSON API routes. No framework or session code here, so they're unit-testable.
 */

export const json = (status: number, body: unknown) => Response.json(body, { status });
export const empty = (status: number) => new Response(null, { status });
export const error = (status: number, message: string) => json(status, { error: message });

/** Request bodies above this are rejected. A 20-team, 30-round draft is well under 100 KB. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * True unless the request carries an Origin from another site. Browsers always send Origin on
 * cross-origin fetches, so this blocks cross-site writes on top of the session cookie's SameSite=Lax.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Parses a JSON body, or returns the error response to send. */
export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return { ok: false, response: error(415, "Expected application/json") };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false, response: error(413, "Request body too large") };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: error(400, "Malformed JSON") };
  }
}
