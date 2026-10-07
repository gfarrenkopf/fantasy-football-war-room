"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/components/draft/useMediaQuery";
import { bookmarkletFor } from "@/lib/espn/bookmarklet";
import { ESPN_FANTASY_HOME } from "@/lib/espn/pages";

/** A touch screen: no bookmarks bar to drag to, so the bookmark is copied and pasted instead (APE-299). */
const TOUCH = "(pointer: coarse)";

type Phone = "ios" | "ios-chrome" | "android";

/** Saving a bookmarklet on a phone: bookmark any page, then swap its address for the code. */
const PHONE_STEPS: Record<Phone, { label: string; save: string[]; run: string }> = {
  ios: {
    label: "iPhone or iPad (Safari)",
    save: [
      "Tap Copy bookmark code above.",
      "Bookmark this page: tap Share, then Add Bookmark, then Save.",
      "Open your bookmarks (the book icon), tap Edit, then tap the bookmark you just saved.",
      "Name it Draft Room, clear its address, paste the code there, and tap Done.",
    ],
    run: "To use it, open your bookmarks on the ESPN page and tap Draft Room.",
  },
  "ios-chrome": {
    label: "iPhone or iPad (Chrome)",
    save: [
      "Tap Copy bookmark code above.",
      "Bookmark this page: tap ⋯, then Add to Bookmarks.",
      "Tap ⋯ again, then Bookmarks. Touch and hold the bookmark you just saved, and tap Edit Bookmark.",
      "Name it Draft Room, replace its URL with the code you copied, and tap Done.",
    ],
    run: "To use it, tap the address bar on the ESPN page, type Draft Room, and tap the bookmark that comes up, not a search.",
  },
  android: {
    label: "Android (Chrome)",
    save: [
      "Tap Copy bookmark code above.",
      "Bookmark this page: tap ⋮, then the star.",
      "Tap Edit on the message that appears (or find it under ⋮ → Bookmarks and tap its pencil).",
      "Name it Draft Room, replace its URL with the code you copied, and go back to save.",
    ],
    run: "To use it, tap the address bar on the ESPN page, type Draft Room, and tap the bookmark that comes up (with the star), not a search.",
  },
};

const SEASON_STEPS = [
  "Open your league on ESPN in the browser, signed in to ESPN. The links above open pages ESPN's app doesn't take over.",
  "Use the Draft Room bookmark there, then tap Connect my season and agree.",
  "Draft Room opens in the same tab. Sign in if it asks, then tap Connect my season.",
  "That's it for the season: your lineup and trade help are on any device you sign in to Draft Room on.",
];

const DRAFT_STEPS = [
  "Open your draft on fantasy.espn.com. ESPN opens it an hour before the draft.",
  "Use the Draft Room bookmark there, then Connect.",
  "Draft as usual. Picks land on your Draft Room board within a second, and when you're on the clock you can draft straight from Draft Room. Keep the ESPN tab open; it can sit in the background.",
];

/** Chrome on iOS says CriOS in its user agent; it shares Safari's engine but not its bookmark menus. */
function detectPhone(): Phone {
  const ua = navigator.userAgent;
  return /android/i.test(ua) ? "android" : /CriOS/.test(ua) ? "ios-chrome" : "ios";
}

/** Setup instructions with the War Room bookmark: dragged on a computer, copied on a phone. See src/app/espn/page.tsx. */
/** The user's connected leagues, each linked to its ESPN page that stays in the browser (APE-303). */
export interface EspnLeagueLink {
  name: string;
  url: string;
}

export function BridgeInstall({ season, leagues }: { season: boolean; leagues: EspnLeagueLink[] }) {
  const touch = useMediaQuery(TOUCH);
  const link = useRef<HTMLAnchorElement>(null);
  // Only ever true on the client (the server renders the desktop layout), so `location` is there.
  const code = touch ? bookmarkletFor(location.origin) : "";
  const phone: Phone = touch ? detectPhone() : "ios";
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  // React blocks javascript: URLs in href, so the dragged bookmark's href is set directly once mounted.
  useEffect(() => link.current?.setAttribute("href", bookmarkletFor(location.origin)), [touch]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  // The visitor's own phone first and open; the others below, closed.
  const order: Phone[] = [phone, ...(["ios", "ios-chrome", "android"] as const).filter((p) => p !== phone)];

  return (
    <main className="min-h-dvh bg-bg text-text px-5 py-8 font-sans">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted">Draft Room</p>
          <h1 className="text-2xl font-semibold">The Draft Room bookmark</h1>
          <p className="text-muted">
            One bookmark connects Draft Room to ESPN{season ? ": your season's lineup and trade help, and your live draft" : " for your live draft"}. Add it once, on a
            computer or your phone.
          </p>
        </header>

        {touch ? (
          <section className="space-y-3 rounded-card border border-line bg-panel p-4">
            <button type="button" className="w-full rounded-card bg-mine px-4 py-3 font-semibold text-mine-ink" onClick={copy} disabled={!code}>
              {copied === "done" ? "Copied ✓" : "Copy bookmark code"}
            </button>
            {copied === "failed" && (
              <div className="space-y-1 text-sm">
                <p className="text-warn-ink" role="alert">
                  Couldn&apos;t copy. Select all of this and copy it instead:
                </p>
                <textarea readOnly className="h-24 w-full rounded-card border border-line2 bg-panel2 p-2 font-mono text-xs" value={code} onFocus={(e) => e.target.select()} />
              </div>
            )}
            {order.map((key) => {
              const steps = PHONE_STEPS[key];
              return (
                <details key={key} open={key === phone} className="rounded-card border border-line2 bg-panel2 p-3 text-sm">
                  <summary className="cursor-pointer font-semibold">{steps.label}</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    {steps.save.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <p className="mt-2 text-muted">{steps.run}</p>
                </details>
              );
            })}
            <p className="text-sm text-muted">
              The bookmark only runs in the browser, not the ESPN app. If a link to ESPN opens the app anyway, come back, touch and hold the link, and choose Open
              in New Tab.
            </p>
          </section>
        ) : (
          <div className="flex items-center gap-3 rounded-card border border-line bg-panel p-4">
            <a ref={link} className="rounded-card bg-mine px-4 py-2 font-semibold text-mine-ink no-underline cursor-grab" onClick={(e) => e.preventDefault()} draggable>
              Draft Room
            </a>
            <span className="text-sm text-muted">← drag this to your bookmarks bar</span>
          </div>
        )}

        {season && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Connect your season</h2>
            <div className="flex flex-wrap gap-2">
              {leagues.map((l) => (
                <a key={l.url} href={l.url} className="rounded-card border border-line bg-panel px-3 py-2 text-sm font-semibold no-underline">
                  Open {l.name} on ESPN ↗
                </a>
              ))}
              <a href={ESPN_FANTASY_HOME} className="rounded-card border border-line bg-panel px-3 py-2 text-sm no-underline">
                {leagues.length ? "Another league: sign in to ESPN Fantasy ↗" : "Sign in to ESPN Fantasy in this browser ↗"}
              </a>
            </div>
            <ol className="list-decimal space-y-2 pl-5">
              {SEASON_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="text-sm text-dim">
              This hands Draft Room your ESPN login cookies (not your password), stored encrypted and used only to read your leagues. ESPN signs Draft Room out every so often; when it does, use the bookmark on your league page again.
            </p>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Sync your draft</h2>
          <ol className="list-decimal space-y-2 pl-5">
            {DRAFT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-sm text-dim">
            For the draft, the bookmark reads draft data from your ESPN tab (picks and the clock), and makes a pick there only when you draft from Draft Room; it never
            sends Draft Room your ESPN password or cookies. ESPN live sync is unofficial and not endorsed by ESPN, so it can stop working if ESPN changes their draft
            room. Your board always works by hand.
          </p>
        </section>
      </div>
    </main>
  );
}
