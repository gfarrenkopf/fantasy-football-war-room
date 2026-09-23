"use client";

import { useEffect, useState } from "react";
import { draftCountdown, type DraftCountdown } from "@/lib/draft/draftDay";
import { useDraft } from "./DraftProvider";
import { useLeague } from "./LeagueProvider";

const HOUR = 3_600_000;

/**
 * The countdown to the open league's draft, while there is one to show: the league has a draft
 * date still ahead and no pick has been logged. Null otherwise — the first pick ends it, and so
 * does the draft's start time passing.
 *
 * Ticks once a minute, every second in the last hour, and not at all while the tab is hidden.
 * It starts null and reads the clock after mount, so server and client render the same markup.
 */
export function useDraftClock(): DraftCountdown | null {
  const { active } = useLeague();
  const { state } = useDraft();
  const draftAt = state.picks.length ? null : (active?.draftAt ?? null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!draftAt) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const at = new Date();
      setNow(at);
      const left = draftCountdown(draftAt, at);
      if (!left || left.phase === "started" || document.hidden) return;
      timer = setTimeout(tick, left.ms <= HOUR ? 1000 - (at.getTime() % 1000) : 60_000 - (at.getTime() % 60_000));
    };
    const onVisible = () => {
      clearTimeout(timer);
      if (!document.hidden) tick();
    };
    timer = setTimeout(tick, 0);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [draftAt]);

  if (!draftAt || !now) return null;
  const c = draftCountdown(draftAt, now);
  return c && c.phase !== "started" ? c : null;
}
