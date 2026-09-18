"use client";

import { useCallback, useSyncExternalStore } from "react";

/** The phone breakpoint. Must match `@media (max-width: 767px)` in warRoom.module.css. */
export const PHONE = "(max-width: 767px)";

/**
 * Whether a media query matches, for behavior CSS cannot carry alone (a panel that collapses, a
 * list that replaces the board). The server snapshot is `false`, so the first render and hydration
 * are the desktop layout and the phone one takes over on the client without a mismatch.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
