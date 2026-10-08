"use client";

import { useSyncExternalStore } from "react";

/** "Sun 1:00 PM": a kickoff, a waiver run, a news stamp. */
export const WEEKDAY_TIME: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };

/** "Sun, Nov 22, 1:00 PM": a date further off, like the trade deadline. */
export const WEEKDAY_DATE_TIME: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/** Where NFL times are set, and what the page shows until the reader's own zone is known. */
const FALLBACK_ZONE = "America/New_York";

const noSubscription = () => () => {};

/**
 * An instant on the reader's clock (APE-323). The server's time zone isn't the reader's (the droplet
 * runs on UTC), and suppressHydrationWarning keeps the server's text, so a server-formatted time showed
 * a 1 PM kickoff as 5 PM until something re-rendered it. The server and hydration render Eastern time;
 * the browser then swaps in its own zone.
 */
export function useLocalTime(iso: string | null | undefined, format: Intl.DateTimeFormatOptions = WEEKDAY_TIME): string {
  return useSyncExternalStore(
    noSubscription,
    () => (iso ? new Date(iso).toLocaleString([], format) : ""),
    () => (iso ? new Date(iso).toLocaleString("en-US", { ...format, timeZone: FALLBACK_ZONE }) : ""),
  );
}

export function LocalTime({ iso, format }: { iso: string; format?: Intl.DateTimeFormatOptions }) {
  return <>{useLocalTime(iso, format)}</>;
}
