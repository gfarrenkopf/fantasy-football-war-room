"use client";

import { useEffect, useState } from "react";
import { SignIn } from "@/components/landing/SignIn";
import { listenForSignIn } from "@/lib/auth/channel";
import { announceEspnPaired } from "@/lib/espn/channel";
import type { PublicFlags } from "@/lib/config";

/** Where the bridge runs. The token is only ever posted to this origin. */
const ESPN_ORIGIN = "https://fantasy.espn.com";

type Phase =
  | { kind: "idle" }
  | { kind: "pairing" }
  | { kind: "done"; delivered: boolean }
  | { kind: "error"; message: string; needsPurchase?: boolean };

interface LeagueOption {
  id: string;
  name: string;
  teams: number;
}

/** The pairing popup's body. See src/app/espn/pair/page.tsx. */
export function EspnPair({
  flags,
  signedIn,
  espn,
  leagues,
  defaultLeagueId,
}: {
  flags: PublicFlags;
  signedIn: boolean;
  espn: { leagueId: string; teamId: number; season: number };
  leagues: LeagueOption[];
  defaultLeagueId: string | null;
}) {
  const [leagueId, setLeagueId] = useState(defaultLeagueId ?? "");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Signing in finishes in another tab (the magic link); pick it up here.
  useEffect(() => (signedIn ? undefined : listenForSignIn(() => location.reload())), [signedIn]);

  const validEspn = /^\d+$/.test(espn.leagueId) && espn.teamId > 0 && espn.season > 0;

  async function connect() {
    setPhase({ kind: "pairing" });
    const res = await fetch("/api/espn/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leagueId, espnLeagueId: espn.leagueId, espnTeamId: espn.teamId, season: espn.season }),
    }).catch(() => null);
    if (!res) return setPhase({ kind: "error", message: "Couldn't reach War Room. Check your connection and try again." });
    if (res.status === 402) return setPhase({ kind: "error", message: "Live sync comes with this league's season pass.", needsPurchase: true });
    if (res.status === 403) return setPhase({ kind: "error", message: "ESPN live sync isn't available on your account yet. It's in a limited beta." });
    if (res.status === 401) return location.reload();
    if (!res.ok) return setPhase({ kind: "error", message: "Something went wrong connecting. Try again." });
    const { token } = (await res.json()) as { token: string };
    const opener = window.opener as Window | null;
    opener?.postMessage({ type: "warroom-bridge-paired", token }, ESPN_ORIGIN);
    announceEspnPaired(leagueId);
    setPhase({ kind: "done", delivered: !!opener });
    if (opener) setTimeout(() => window.close(), 1500);
  }

  const league = leagues.find((l) => l.id === leagueId);

  return (
    <main className="min-h-dvh bg-bg text-text px-5 py-6 font-sans">
      <div className="mx-auto max-w-md space-y-4">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted">Fantasy War Room</p>
          <h1 className="text-xl font-semibold">Connect your ESPN draft</h1>
          <p className="text-sm text-muted">Picks made in your ESPN draft room will land on your War Room board as they happen.</p>
        </header>

        {!validEspn ? (
          <p className="rounded-card border border-line bg-panel p-4 text-sm">
            Open this from the War Room bookmark inside your ESPN draft room, so it knows which draft to connect.
          </p>
        ) : !signedIn ? (
          <section className="rounded-card border border-line bg-panel p-4">
            <SignIn flags={flags} title="Sign in to War Room first" fine="Then come back to this window. It picks up your sign-in on its own." autoFocus />
          </section>
        ) : phase.kind === "done" ? (
          <section className="rounded-card border border-line bg-panel p-4 space-y-2" role="status">
            <p className="font-semibold text-mine">Connected to {league?.name ?? "your league"}.</p>
            <p className="text-sm text-muted">
              {phase.delivered
                ? "Keep your ESPN draft tab open; picks will show up on your board. This window will close."
                : "Go back to your ESPN draft tab and click Connect there again to finish."}
            </p>
          </section>
        ) : leagues.length === 0 ? (
          <p className="rounded-card border border-line bg-panel p-4 text-sm">
            You don&apos;t have a War Room league yet. <a className="text-focus underline" href="/draft" target="_blank" rel="noreferrer">Set one up</a>, then click Connect in ESPN again.
          </p>
        ) : (
          <section className="rounded-card border border-line bg-panel p-4 space-y-3">
            <label className="block text-sm">
              <span className="text-muted">Sync ESPN league {espn.leagueId} into</span>
              <select
                className="mt-1 block w-full rounded-card border border-line2 bg-panel2 px-2 py-2 text-base"
                value={leagueId}
                onChange={(e) => setLeagueId(e.target.value)}
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.teams} teams)
                  </option>
                ))}
              </select>
            </label>
            {phase.kind === "error" && (
              <p className="text-sm text-warn-ink" role="alert">
                {phase.message}{" "}
                {phase.needsPurchase && (
                  <a className="text-focus underline" href="/draft" target="_blank" rel="noreferrer">
                    Get the season pass
                  </a>
                )}
              </p>
            )}
            <button
              type="button"
              className="w-full rounded-card bg-mine px-3 py-2 font-semibold text-mine-ink disabled:opacity-60"
              disabled={!leagueId || phase.kind === "pairing"}
              onClick={connect}
            >
              {phase.kind === "pairing" ? "Connecting…" : "Connect"}
            </button>
            <p className="text-xs text-dim">War Room only receives draft data from your ESPN tab: picks and the draft clock. It never sees your ESPN password or cookies.</p>
          </section>
        )}
      </div>
    </main>
  );
}
