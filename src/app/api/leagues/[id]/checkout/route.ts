import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { startCheckout } from "@/lib/server/checkout";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json } from "@/lib/server/http";
import { getStripe } from "@/lib/server/stripe";

type Ctx = RouteContext<"/api/leagues/[id]/checkout">;

const ROUTE = "/api/leagues/[id]/checkout";

/**
 * POST /api/leagues/:id/checkout → { url } of a Stripe Checkout page for the league's season pass.
 * 404 when payments are off or the league isn't on the server, 409 when it's already paid for,
 * 503 (logged) when Stripe can't be reached. `?from=season` sends the buyer back to the season page.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const stripe = getStripe();
  if (!stripe || !config.stripePriceId) return error(404, "Not found");
  const { id } = await ctx.params;
  try {
    const result = await startCheckout(db, (params) => stripe.checkout.sessions.create(params), {
      userId,
      email,
      leagueId: id,
      priceId: config.stripePriceId,
      // Behind the proxy request.url is the internal address, so prefer the public URL.
      baseUrl: config.nextAuthUrl ?? new URL(request.url).origin,
      from: new URL(request.url).searchParams.get("from") === "season" ? "season" : "draft",
    });
    if (result.status === "not-found") return error(404, "League not found");
    if (result.status === "already-paid") return error(409, "This league already has a season pass");
    return json(200, { url: result.url });
  } catch (err) {
    console.error(formatServerError(err, { method: request.method, path: new URL(request.url).pathname }, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Checkout is temporarily unavailable");
  }
});
