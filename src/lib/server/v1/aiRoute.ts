import "server-only";
import { seasonAiRequest, seasonAiState, type SeasonAiRequest } from "@/lib/server/ai/season";
import type { Db } from "@/lib/db/types";
import { json } from "@/lib/server/http";
import { AI_LOCKED, aiResponse, type AiResponse } from "./ai";

interface Who {
  userId: string;
  email: string | null;
}

/**
 * The web's checks before an in-season AI write (seasonAiRequest()), answered for the app: a 402
 * says the league is locked, in AI_LOCKED's words, with nothing about buying.
 */
export async function appAiRequest(db: Db, who: Who, leagueId: string): Promise<SeasonAiRequest | Response> {
  const req = await seasonAiRequest(db, who, leagueId);
  if (req instanceof Response && req.status === 402) return json(402, { error: AI_LOCKED, locked: true });
  return req;
}

/** GET ai's body, read again after a write so the app gets the new state in one round trip. */
export async function appAiResponse(db: Db, who: Who, req: SeasonAiRequest): Promise<AiResponse | null> {
  const ai = await seasonAiState(db, who, req.league, req.view);
  return ai && aiResponse(req.view, ai);
}
