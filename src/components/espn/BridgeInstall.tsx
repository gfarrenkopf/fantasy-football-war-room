"use client";

import { useEffect, useRef } from "react";
import { bookmarkletFor } from "@/lib/espn/bookmarklet";

const STEPS = [
  "Drag the War Room button to your bookmarks bar. You only do this once.",
  "Open your draft room on fantasy.espn.com. ESPN opens it an hour before the draft.",
  "Click the War Room bookmark there, then Connect.",
  "Draft as usual. Picks land on your War Room board within a second, and when you're on the clock you can draft straight from War Room. Keep the ESPN tab open; it can sit in the background.",
];

/** Setup instructions with the draggable bookmark. See src/app/espn/page.tsx. */
export function BridgeInstall() {
  const link = useRef<HTMLAnchorElement>(null);
  // React blocks javascript: URLs in href, so the bookmark's href is set directly once mounted.
  useEffect(() => link.current?.setAttribute("href", bookmarkletFor(location.origin)), []);

  return (
    <main className="min-h-dvh bg-bg text-text px-5 py-8 font-sans">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted">Fantasy War Room</p>
          <h1 className="text-2xl font-semibold">Sync your ESPN draft</h1>
          <p className="text-muted">Stop tabbing back and forth. Every pick in your ESPN draft shows up on your War Room board, on this computer or your phone.</p>
        </header>

        <div className="flex items-center gap-3 rounded-card border border-line bg-panel p-4">
          <a
            ref={link}
            className="rounded-card bg-mine px-4 py-2 font-semibold text-mine-ink no-underline cursor-grab"
            onClick={(e) => e.preventDefault()}
            draggable
          >
            War Room
          </a>
          <span className="text-sm text-muted">← drag this to your bookmarks bar</span>
        </div>

        <ol className="list-decimal space-y-2 pl-5">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <p className="text-sm text-dim">
          Works in desktop browsers. The bookmark reads draft data from your ESPN tab (picks and the clock), and makes a pick there only when you draft from War Room;
          War Room never sees your ESPN password or cookies. ESPN
          live sync is unofficial and not endorsed by ESPN, so it can stop working if ESPN changes their draft room. Your board always works by hand.
        </p>
      </div>
    </main>
  );
}
