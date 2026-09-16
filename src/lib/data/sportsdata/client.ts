import type { SdBye, SdFantasyPlayer, SdSeasonProjection, SdSnapshot } from "./types";

/**
 * Typed wrapper around the SportsDataIO endpoints the pipeline needs (2.1).
 *
 * The API key is passed in, never read from the environment here: the app reads it
 * through `config.ts` (server-only), and the ingestion CLI reads it through
 * `scripts/ingest/env.mts`. This module stays usable from both without importing
 * `server-only`, which would break the CLI.
 *
 * The key travels in a header, never a query string, so it can't leak into logs
 * or redirect URLs.
 */

const BASE = "https://api.sportsdata.io/v3/nfl";

/**
 * Note: no constructor parameter properties anywhere under `src/lib/data/` — the
 * ingestion CLI runs this code through Node's strip-only TypeScript support, which
 * rejects any syntax that needs code generation (parameter properties, enums,
 * namespaces, decorators).
 */
export class SportsDataError extends Error {
  endpoint: string;
  status: number;

  constructor(endpoint: string, status: number, message: string) {
    super(`SportsDataIO ${endpoint} failed: ${message}`);
    this.name = "SportsDataError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

export interface ClientOptions {
  apiKey: string;
  /** Season to fetch projections and byes for, e.g. 2026. */
  season: number;
  fetchImpl?: typeof fetch;
}

async function getJson<T>(path: string, { apiKey, fetchImpl = fetch }: ClientOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${path}`, { headers: { "Ocp-Apim-Subscription-Key": apiKey } });
  } catch (cause) {
    throw new SportsDataError(path, 0, `network error: ${(cause as Error).message}`);
  }
  if (!res.ok) {
    // 401 means the key's tier doesn't include this endpoint; 404 often means the
    // same thing rather than a bad path. Say so, since it's the common failure.
    const hint = res.status === 401 || res.status === 404 ? " (endpoint may not be included in this key's subscription tier)" : "";
    throw new SportsDataError(path, res.status, `HTTP ${res.status} ${res.statusText}${hint}`);
  }
  return (await res.json()) as T;
}

export function createClient(options: ClientOptions) {
  return {
    fantasyPlayers: () => getJson<SdFantasyPlayer[]>("/stats/json/FantasyPlayers", options),
    projections: () => getJson<SdSeasonProjection[]>(`/projections/json/PlayerSeasonProjectionStats/${options.season}REG`, options),
    byes: () => getJson<SdBye[]>(`/scores/json/Byes/${options.season}`, options),

    /** All three endpoints in parallel. */
    async snapshot(): Promise<SdSnapshot> {
      const [fantasyPlayers, projections, byes] = await Promise.all([this.fantasyPlayers(), this.projections(), this.byes()]);
      return { fantasyPlayers, projections, byes };
    },
  };
}

export type SportsDataClient = ReturnType<typeof createClient>;
