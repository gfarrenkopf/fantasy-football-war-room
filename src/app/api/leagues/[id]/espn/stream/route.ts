import type { LiveEvent } from "@/lib/espn/live";
import { withUser } from "@/lib/server/api";
import { config } from "@/lib/config";
import { espnAccess } from "@/lib/server/espn/access";
import { getRelay } from "@/lib/server/espn/live";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/espn/stream">;

/** How often an open stream re-checks the bridge's liveness and sends a keepalive. */
const TICK_MS = 5000;

const encoder = new TextEncoder();
const frame = (event: LiveEvent) => encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

/**
 * GET /api/leagues/:id/espn/stream → text/event-stream of LiveEvents (src/lib/espn/live.ts)
 *
 * The war room's view of the league's ESPN draft: a `snapshot` first, then `pick`, `clock` and
 * `status` events as the bridge relays them. EventSource reconnects on its own after a drop or a
 * deploy, and every connection starts with a fresh snapshot, so nothing needs replaying.
 * 404 when ESPN sync is off or the league isn't the user's, 403 outside the beta, 402 without a pass.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  if (!config.espnSyncEnabled) return error(404, "Not found");
  const { id } = await ctx.params;
  if (!(await findLeague(db, userId, id))) return error(404, "League not found");
  const access = await espnAccess(db, id, email);
  if (access.kind === "not-allowed") return error(403, "ESPN live sync isn't available on this account yet");
  if (access.kind === "needs-purchase") return json(402, { needsPurchase: true });

  const relay = getRelay();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: LiveEvent) => controller.enqueue(frame(event));
      const { snapshot, unsubscribe } = relay.subscribe(userId, id, send);
      send({ type: "snapshot", snapshot });
      const tick = setInterval(() => {
        try {
          relay.checkStatus(userId, id);
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, TICK_MS);
      cleanup = () => {
        clearInterval(tick);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no", Connection: "keep-alive" },
  });
});
