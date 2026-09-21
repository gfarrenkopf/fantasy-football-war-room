"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { dataset } from "@/lib/data";
import { createSimContext, defaultRoom, mulberry32, simulateFrom } from "@/lib/draft/sim";
import { isMyPick, nextMyPick } from "@/lib/draft/snake";
import type { DraftPick, LeagueSettings } from "@/lib/draft/types";

export interface LiveMock {
  /** The full simulated draft, so a consumer can look ahead as well as behind. */
  full: DraftPick[];
  /** How many of `full` have been revealed so far. */
  revealed: number;
  /** Players taken so far, by id, with the pick number that took them. */
  taken: Map<string, { mine: boolean; n: number }>;
  /** Counts the drafts dealt for this league, so a fresh one can remount what shows it. */
  deal: number;
}

/** How long a finished draft stays on the board before a new one is dealt. */
const BETWEEN_DRAFTS_MS = 6000;

/**
 * How long the room waits before logging the next pick, given how many are already on the board.
 *
 * The draft is paced like a real one feels: the picks far from yours go by quickly, the room slows
 * as your turn approaches, it holds while you are on the clock, and after your pick lands it waits
 * long enough for you to read what you got. Only the reveal is timed — the picks themselves are
 * the simulator's.
 */
function delayFor(revealed: number, full: DraftPick[], league: LeagueSettings): number {
  if (revealed > 0 && full[revealed - 1]?.mine) return 3400; // your pick just landed: let it read
  const current = revealed + 1;
  if (isMyPick(current, league)) return 1900; // on the clock
  const until = nextMyPick(current, league) - current;
  if (until <= 1) return 1400;
  if (until <= 3) return 950;
  return 560;
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/**
 * A real mock draft of the visitor's league, revealed one pick at a time.
 *
 * The draft itself is not theatre: it comes from simulateFrom() — the same simulator the war room
 * runs — against the same CPU styles and the same bundled dataset, with the simulator's auto-pick
 * making the visitor's picks. Editing the league re-simulates, so the board is always this
 * visitor's draft rather than a generic one.
 *
 * With reduced motion the room does not tick: it opens with the visitor's first pick already made,
 * so the moment is still there, just without the wait.
 */
export function useLiveMock(league: LeagueSettings, reduced: boolean): LiveMock {
  const ctx = useMemo(() => createSimContext(league, dataset.players), [league]);
  const room = useMemo(() => defaultRoom(league.teams), [league.teams]);

  // Simulated after the first paint, never during render: the seed is time-based, so a
  // render-time draft would differ between server and client and break hydration — and a few
  // hundred CPU picks have no business sitting in front of the panel appearing.
  const [full, setFull] = useState<DraftPick[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [deal, setDeal] = useState(0);
  // A macrotask rather than an animation frame: frames never fire in a background tab, and a
  // visitor who opens the page behind another one should find it ready (the room itself waits).
  useEffect(() => {
    const t = setTimeout(() => {
      setFull(simulateFrom([], room, ctx, { autoMe: true, rng: mulberry32(Date.now() & 0xffffffff) }));
      setRevealed(reduced ? league.mySlot : 0);
    }, 0);
    return () => clearTimeout(t);
  }, [ctx, room, reduced, league.mySlot, deal]);

  // A chain of timeouts rather than an interval, because the pace changes pick by pick. A hidden
  // tab stops the room — including one opened in the background — so nobody comes back to find
  // the draft over and their pick missed.
  const hidden = useSyncExternalStore(subscribeVisibility, () => document.hidden, () => false);
  useEffect(() => {
    if (reduced || hidden || !full.length) return;
    // A visitor who stays to the end sees the room start over, not a board frozen on "Draft over".
    if (revealed >= full.length) {
      const t = setTimeout(() => setDeal((d) => d + 1), BETWEEN_DRAFTS_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRevealed((n) => Math.min(n + 1, full.length)), delayFor(revealed, full, league));
    return () => clearTimeout(t);
  }, [reduced, hidden, full, revealed, league]);

  const taken = useMemo(() => {
    const map = new Map<string, { mine: boolean; n: number }>();
    for (let i = 0; i < revealed; i++) map.set(full[i].playerId, { mine: full[i].mine, n: i + 1 });
    return map;
  }, [full, revealed]);

  return { full, revealed, taken, deal };
}
