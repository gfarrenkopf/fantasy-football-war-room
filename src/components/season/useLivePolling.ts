"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** How often the page reloads its data while a game is on. The server reads ESPN at most every 45s then. */
export const LIVE_POLL_MS = 60 * 1000;

/**
 * Keeps a game day page fresh (APE-227): while `live`, reloads the page's data every minute, pauses
 * while the tab is hidden, and reloads at once when it comes back. `?refresh=1` is dropped first, so
 * each reload uses the server's short live cache instead of reading every ESPN source again.
 */
export function useLivePolling(live: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("refresh")) {
      url.searchParams.delete("refresh");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    let last = Date.now();
    const reload = () => {
      last = Date.now();
      router.refresh();
    };
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, LIVE_POLL_MS);
    const onVisible = () => {
      if (!document.hidden && Date.now() - last >= LIVE_POLL_MS) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, router]);
}
