import { empty } from "@/lib/server/http";

/** The only page that may call the bridge's routes: the user's ESPN draft tab, where the bridge runs. */
export const ESPN_ORIGIN = "https://fantasy.espn.com";

export function withCors(response: Response, request: Request): Response {
  if (request.headers.get("origin") === ESPN_ORIGIN) {
    response.headers.set("Access-Control-Allow-Origin", ESPN_ORIGIN);
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** CORS preflight for the bridge's JSON POSTs with an Authorization header. */
export function preflight(request: Request, enabled: boolean): Response {
  if (!enabled || request.headers.get("origin") !== ESPN_ORIGIN) return empty(404);
  const response = empty(204);
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "authorization, content-type");
  response.headers.set("Access-Control-Max-Age", "600");
  // Chrome's Private Network Access asks before a public site calls a local server, as it does when
  // testing the bridge against `next dev` on localhost. Harmless for the hosted site.
  if (request.headers.get("access-control-request-private-network") === "true") response.headers.set("Access-Control-Allow-Private-Network", "true");
  return withCors(response, request);
}
