"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SignIn } from "@/components/landing/SignIn";
import type { PublicFlags } from "@/lib/config";
import { listenForSignIn } from "@/lib/auth/channel";
import { ESPN_SEASON_DISCLOSURE, ESPN_SEASON_VERSION } from "@/lib/espn/disclosure";

/** Where the bridge runs. The login request only ever goes to this origin. */
const ESPN_ORIGIN = "https://fantasy.espn.com";
/** How long to wait for the bridge to answer before assuming the ESPN tab is gone. */
const BRIDGE_TIMEOUT_MS = 5000;

type Phase = { kind: "idle" } | { kind: "connecting" } | { kind: "error"; message: string };

interface EspnLogin {
  espnS2: string;
  swid: string;
}

/** Asks the bridge in the ESPN tab that opened this window for the user's ESPN login. */
function askBridgeForLogin(espnLeagueId: string): Promise<EspnLogin | "signed-out" | "no-bridge"> {
  const opener = window.opener as Window | null;
  if (!opener) return Promise.resolve("no-bridge");
  return new Promise((resolve) => {
    const done = (value: EspnLogin | "signed-out" | "no-bridge") => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== ESPN_ORIGIN || e.source !== opener || e.data?.type !== "warroom-season-login") return;
      if (e.data.espnLeagueId !== espnLeagueId) return;
      done(e.data.login ?? "signed-out");
    };
    const timer = setTimeout(() => done("no-bridge"), BRIDGE_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    opener.postMessage({ type: "warroom-season-login?" }, ESPN_ORIGIN);
  });
}

/** The season popup's body. See src/app/espn/season/page.tsx. */
export function EspnSeasonConnect({
  flags,
  signedIn,
  allowed,
  espn,
}: {
  flags: PublicFlags;
  signedIn: boolean;
  allowed: boolean;
  espn: { leagueId: string; season: number };
}) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Signing in finishes in another tab (the magic link); pick it up here.
  useEffect(() => (signedIn ? undefined : listenForSignIn(() => location.reload())), [signedIn]);

  const valid = /^\d+$/.test(espn.leagueId) && espn.season > 0;

  async function connect() {
    setPhase({ kind: "connecting" });
    const login = await askBridgeForLogin(espn.leagueId);
    if (login === "no-bridge") {
      return setPhase({ kind: "error", message: "Lost touch with your ESPN tab. Click the War Room bookmark on your ESPN league page again." });
    }
    if (login === "signed-out") return setPhase({ kind: "error", message: "ESPN says you're signed out in that tab. Sign in to ESPN, then try again." });
    const res = await fetch("/api/espn/season/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ espnLeagueId: espn.leagueId, season: espn.season, consentVersion: ESPN_SEASON_VERSION, ...login }),
    }).catch(() => null);
    if (!res) return setPhase({ kind: "error", message: "Couldn't reach War Room. Check your connection and try again." });
    if (res.status === 401 || res.status === 409) return location.reload();
    const body = (await res.json().catch(() => ({}))) as { leagueId?: string; error?: string };
    if (!res.ok || !body.leagueId) return setPhase({ kind: "error", message: body.error ?? "Something went wrong connecting. Try again." });
    (window.opener as Window | null)?.postMessage({ type: "warroom-season-connected" }, ESPN_ORIGIN);
    router.push(`/season/${body.leagueId}`);
  }

  return (
    <main className="min-h-dvh bg-bg text-text px-5 py-6 font-sans">
      <div className="mx-auto max-w-md space-y-4">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted">Fantasy War Room</p>
          <h1 className="text-xl font-semibold">Connect your season</h1>
          <p className="text-sm text-muted">A recommended lineup every week, and trade checks against every team&apos;s real roster.</p>
        </header>

        {!valid ? (
          <p className="rounded-card border border-line bg-panel p-4 text-sm">
            Open this from the War Room bookmark on your ESPN league page, so it knows which league to connect.
          </p>
        ) : !signedIn ? (
          <section className="rounded-card border border-line bg-panel p-4">
            <SignIn flags={flags} title="Sign in to War Room first" fine="Then come back to this window. It picks up your sign-in on its own." autoFocus />
          </section>
        ) : !allowed ? (
          <p className="rounded-card border border-line bg-panel p-4 text-sm">In-season help isn&apos;t available on your account yet. It&apos;s in a limited beta.</p>
        ) : (
          <section className="rounded-card border border-line bg-panel p-4 space-y-3">
            <div className="space-y-2 rounded-card border border-line2 bg-panel2 p-3 text-sm">
              <p className="font-semibold">Before you connect</p>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {ESPN_SEASON_DISCLOSURE.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>I understand</span>
              </label>
            </div>
            {phase.kind === "error" && (
              <p className="text-sm text-warn-ink" role="alert">
                {phase.message}
              </p>
            )}
            <button
              type="button"
              className="w-full rounded-card bg-mine px-3 py-2 font-semibold text-mine-ink disabled:opacity-60"
              disabled={!agreed || phase.kind === "connecting"}
              onClick={connect}
            >
              {phase.kind === "connecting" ? "Connecting…" : "Connect my season"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
