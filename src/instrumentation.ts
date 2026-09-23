import type { Instrumentation } from "next";
import { formatServerError } from "@/lib/server/errorLog";

/**
 * Runs once when the server process starts. Rejoins the ESPN drafts the previous process was holding
 * for its users (9.5), without holding up the boot: the site answers while the sockets reconnect.
 */
export async function register() {
  // Node only: the server-side ESPN client needs sockets and the database.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getDb }, { config }, { resumeServerClients }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/config"),
    import("@/lib/server/espn/clients"),
  ]);
  if (!config.espnServerClientEnabled) return;
  void resumeServerClients(getDb()).catch((err: unknown) => console.error(`[espn-client] resume failed: ${(err as Error).message}`));
}

/** Logs every server error Next captures as one tagged line, which the droplet's alert job watches. */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(formatServerError(error, request, context));
};
