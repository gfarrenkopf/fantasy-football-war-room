import { POSITIONS, type Position } from "@/lib/draft/types";
import { rateLimiter } from "../rateLimit";

/**
 * The query both player-search routes take (APE-409): `?q=` a name, `&pos=` one position, `&offset=`
 * how far down the pool to start, `&refresh=1` to read ESPN again. A name under two letters browses.
 */
export type PlayerSearch = { name?: string; position?: Position; offset: number; refresh: boolean };

/** Longer than any name ESPN has; cuts off a pasted paragraph. */
const MAX_NAME = 40;
/** ESPN's pool runs to a few hundred players; past this a page is empty anyway. */
const MAX_OFFSET = 1000;

/** The search in a URL; null when a parameter is malformed. */
export function parsePlayerSearch(url: URL): PlayerSearch | null {
  const q = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  const pos = url.searchParams.get("pos");
  const rawOffset = url.searchParams.get("offset") ?? "0";
  const offset = Number(rawOffset);
  if (q.length > MAX_NAME) return null;
  if (pos !== null && pos !== "" && !POSITIONS.includes(pos as Position)) return null;
  if (!/^\d+$/.test(rawOffset) || offset > MAX_OFFSET) return null;
  return {
    ...(q.length >= 2 ? { name: q } : {}),
    ...(pos ? { position: pos as Position } : {}),
    offset,
    refresh: url.searchParams.get("refresh") === "1",
  };
}

/** Searching reads ESPN, and a client may search as the user types: a minute's worth per user, shared by web and app. */
export const playerSearchLimiter = rateLimiter({ limit: 60, windowMs: 60_000 });
