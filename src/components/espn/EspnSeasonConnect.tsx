"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SignIn } from "@/components/landing/SignIn";
import type { PublicFlags } from "@/lib/config";
import { listenForSignIn } from "@/lib/auth/channel";

type Phase = { kind: "idle" } | { kind: "connecting" } | { kind: "expired" } | { kind: "error"; message: string };

/** A claim the bridge handed off, or "expired" when its code is unknown or past its time. */
export type SeasonClaim = { code: string; espnLeagueId: string; season: number } | "expired" | null;

const BACK_TO_ESPN = "Go back to your ESPN league page and tap the Draft Room bookmark again.";

/** The season connect page's body. See src/app/espn/season/page.tsx. */
export function EspnSeasonConnect({ flags, signedIn, allowed, claim }: { flags: PublicFlags; signedIn: boolean; allowed: boolean; claim: SeasonClaim }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(claim === "expired" ? { kind: "expired" } : { kind: "idle" });

  // Signing in can finish in another tab (the magic link); pick it up here.
  useEffect(() => (signedIn ? undefined : listenForSignIn(() => location.reload())), [signedIn]);

  async function connect(code: string) {
    setPhase({ kind: "connecting" });
    const res = await fetch("/api/espn/season/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim: code }),
    }).catch(() => null);
    if (!res) return setPhase({ kind: "error", message: "Couldn't reach Draft Room. Check your connection and try again." });
    if (res.status === 401) return location.reload();
    if (res.status === 410) return setPhase({ kind: "expired" });
    const body = (await res.json().catch(() => ({}))) as { leagueId?: string; error?: string };
    if (!res.ok || !body.leagueId) return setPhase({ kind: "error", message: body.error ?? "Something went wrong connecting. Try again." });
    router.push(`/season/${body.leagueId}`);
  }

  const card = "rounded-card border border-line bg-panel p-4 text-sm space-y-2";
  const howTo = (
    <Link href="/espn" className="text-focus underline">
      How to add the Draft Room bookmark
    </Link>
  );

  return (
    <main className="min-h-dvh bg-bg text-text px-5 py-6 font-sans">
      <div className="mx-auto max-w-md space-y-4">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted">Draft Room</p>
          <h1 className="text-xl font-semibold">Connect your season</h1>
          <p className="text-sm text-muted">A recommended lineup every week, and trade checks against every team&apos;s real roster.</p>
        </header>

        {!claim ? (
          <div className={card}>
            <p>Start from your ESPN league page: open it, tap the Draft Room bookmark, then Connect my season.</p>
            <p>{howTo}</p>
          </div>
        ) : phase.kind === "expired" || claim === "expired" ? (
          <div className={card}>
            <p className="font-semibold">That connect link has expired.</p>
            <p className="text-muted">{BACK_TO_ESPN}</p>
            <p>{howTo}</p>
          </div>
        ) : !signedIn ? (
          <section className="rounded-card border border-line bg-panel p-4">
            <SignIn
              flags={flags}
              title="Sign in to Draft Room to finish"
              fine="The link brings you back here to finish connecting, on whichever device you open it."
              next={`/espn/season?claim=${encodeURIComponent(claim.code)}`}
              autoFocus
            />
          </section>
        ) : !allowed ? (
          <p className="rounded-card border border-line bg-panel p-4 text-sm">In-season help isn&apos;t available on your account yet. It&apos;s in a limited beta.</p>
        ) : (
          <section className="rounded-card border border-line bg-panel p-4 space-y-3">
            <p className="text-sm">
              Connect ESPN league <span className="font-semibold tabular-nums">{claim.espnLeagueId}</span> ({claim.season}) to your Draft Room account.
            </p>
            {phase.kind === "error" && (
              <p className="text-sm text-warn-ink" role="alert">
                {phase.message}
              </p>
            )}
            <button
              type="button"
              className="w-full rounded-card bg-mine px-3 py-3 font-semibold text-mine-ink disabled:opacity-60"
              disabled={phase.kind === "connecting"}
              onClick={() => connect(claim.code)}
            >
              {phase.kind === "connecting" ? "Connecting…" : "Connect my season"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
