import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { listPurchases } from "@/lib/server/entitlements";
import { error, json } from "@/lib/server/http";

/** GET /api/purchases → { purchases: Purchase[] }, newest first. 404 when payments are off. */
export const GET = withUser(async (_request, _ctx, { db, userId }) => {
  if (!config.paymentsEnabled) return error(404, "Not found");
  return json(200, { purchases: await listPurchases(db, userId) });
});
