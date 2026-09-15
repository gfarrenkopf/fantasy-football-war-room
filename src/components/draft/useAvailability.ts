"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AvailabilityRequest, AvailabilityResponse } from "@/lib/draft/sim/availability.worker";
import type { AvailabilityResult } from "@/lib/draft/sim";
import type { CpuStyle, DraftPick } from "@/lib/draft/types";
import { useModel } from "./DraftModel";

export type RunAvailability = (picks: DraftPick[], room: CpuStyle[], n: number) => Promise<AvailabilityResult | null>;

/**
 * Runs Monte Carlo availability in a Web Worker. Each call supersedes the previous one:
 * a stale run resolves to null instead of its (outdated) result.
 */
export function useAvailability(): RunAvailability {
  const { league, dataset } = useModel();
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const pending = useRef(new Map<number, (r: AvailabilityResult | null) => void>());

  useEffect(() => {
    const w = new Worker(new URL("../../lib/draft/sim/availability.worker.ts", import.meta.url));
    const waiting = pending.current;
    w.onmessage = (e: MessageEvent<AvailabilityResponse>) => {
      const { id, n, turns, players, elapsedMs } = e.data;
      const resolve = waiting.get(id);
      waiting.delete(id);
      if (!resolve) return;
      if (id !== latest.current) return resolve(null);
      resolve({ n, turns, elapsedMs, players: new Map(players.map(([pid, available, mine]) => [pid, { available, mine }])) });
    };
    worker.current = w;
    return () => {
      w.terminate();
      waiting.forEach((resolve) => resolve(null));
      waiting.clear();
      worker.current = null;
    };
  }, []);

  return useCallback<RunAvailability>(
    (picks, room, n) =>
      new Promise((resolve) => {
        const w = worker.current;
        if (!w) return resolve(null);
        const id = ++latest.current;
        // Anything still running is now stale.
        pending.current.forEach((r, key) => key !== id && r(null));
        pending.current.clear();
        pending.current.set(id, resolve);
        const request: AvailabilityRequest = { id, picks, league, players: dataset.players, room, n };
        w.postMessage(request);
      }),
    [league, dataset],
  );
}
