/**
 * Runs survivalOdds() off the main thread. Messages are plain JSON: the dataset's players and
 * league come in with the request, and the result's Map is flattened to entries for postMessage.
 */
import type { CpuStyle, DraftPick, LeagueSettings, Player } from "../types";
import { survivalOdds } from "./availability";
import { createSimContext, type SimContext } from "./context";

export interface AvailabilityRequest {
  id: number;
  picks: DraftPick[];
  league: LeagueSettings;
  players: Player[];
  room: CpuStyle[];
  n: number;
}

export interface AvailabilityResponse {
  id: number;
  n: number;
  turns: number[][];
  players: [id: string, available: number[], mine: number[]][];
  elapsedMs: number;
}

let cached: { league: LeagueSettings; players: Player[]; ctx: SimContext } | null = null;

// The DOM lib types `self` as a Window; in a worker it's the worker global scope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AvailabilityRequest>) => void) | null;
  postMessage(message: AvailabilityResponse): void;
};

scope.onmessage = (event) => {
  const { id, picks, league, players, room, n } = event.data;
  // Reuse the sorted indexes across requests for the same league (the dataset is sent once per mount).
  if (!cached || JSON.stringify(cached.league) !== JSON.stringify(league) || cached.players.length !== players.length) {
    cached = { league, players, ctx: createSimContext(league, players) };
  }
  const result = survivalOdds(picks, room, cached.ctx, { n, rng: Math.random });
  const response: AvailabilityResponse = {
    id,
    n: result.n,
    turns: result.turns,
    players: [...result.players].map(([pid, o]) => [pid, o.available, o.mine]),
    elapsedMs: result.elapsedMs,
  };
  scope.postMessage(response);
};
