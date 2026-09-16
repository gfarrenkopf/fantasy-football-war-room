import { withUser } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { listLeagues } from "@/lib/server/leagues";

/** GET /api/leagues → { leagues: LeagueRecord[] } */
export const GET = withUser(async (_request, _ctx, { db, userId }) => json(200, { leagues: await listLeagues(db, userId) }));
