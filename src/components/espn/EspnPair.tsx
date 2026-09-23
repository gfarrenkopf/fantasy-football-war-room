"use client";

import { useEffect, useState } from "react";
import { SignIn } from "@/components/landing/SignIn";
import { listenForSignIn } from "@/lib/auth/channel";
import { DEFAULT_LEAGUE } from "@/lib/data";
import { announceEspnPaired } from "@/lib/espn/channel";
import { ESPN_DISCLOSURE, ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { toLeagueSettings, type EspnImport } from "@/lib/espn/league";
import { newLeagueRecord } from "@/lib/storage/newLeague";
import type { PublicFlags } from "@/lib/config";

/** Where the bridge runs. The token is only ever posted to this origin. */
const ESPN_ORIGIN = "https://fantasy.espn.com";

/** Picked in the league list to build a new league out of ESPN's own settings (8.8). */
const FROM_ESPN = "__espn__";

const SCORING = { ppr: "full PPR", half: "half PPR", std: "standard scoring" } as const;

const espnName = (name: string | undefined, espnLeagueId: string) => name?.trim() || `ESPN league ${espnLeagueId}`;

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
  acknowledged,
  espn,
  leagues,
  defaultLeagueId,
}: {
  flags: PublicFlags;
  signedIn: boolean;
  /** Already acknowledged the current disclosure; otherwise it's shown and must be ticked. */
  acknowledged: boolean;
  espn: { leagueId: string; teamId: number; season: number };
  leagues: LeagueOption[];
  defaultLeagueId: string | null;
}) {
  const [leagueId, setLeagueId] = useState(defaultLeagueId ?? "");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [agreed, setAgreed] = useState(acknowledged);
  /** What ESPN says this league is. Only the bridge can read it: ESPN's API won't answer this origin. */
  const [imported, setImported] = useState<(EspnImport & { name?: string }) | null>(null);

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener || !espn.teamId) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== ESPN_ORIGIN || e.data?.type !== "warroom-bridge-settings") return;
      const settings = e.data.settings as { name?: string } | null;
      if (!settings) return setImported({ ok: false, error: "ESPN didn't share this league's settings." });
      setImported({ ...toLeagueSettings(settings, espn.teamId), name: settings.name });
    };
    window.addEventListener("message", onMessage);
    opener.postMessage({ type: "warroom-bridge-settings?" }, ESPN_ORIGIN);
    return () => window.removeEventListener("message", onMessage);
  }, [espn.teamId]);

  /** The leagues to choose from, plus building one from ESPN when the bridge told us how. */
  const options = [
    ...leagues,
    ...(imported?.ok ? [{ id: FROM_ESPN, name: `${espnName(imported.name, espn.leagueId)} — new, from ESPN`, teams: imported.league.teams }] : []),
  ];

  // Signing in finishes in another tab (the magic link); pick it up here.
  useEffect(() => (signedIn ? undefined : listenForSignIn(() => location.reload())), [signedIn]);

  const validEspn = /^\d+$/.test(espn.leagueId) && espn.teamId > 0 && espn.season > 0;
  const chosen = options.some((o) => o.id === leagueId) ? leagueId : (options[0]?.id ?? "");

  /** Builds the war room league out of ESPN's settings, so the board can't disagree with the draft. */
  async function createFromEspn(): Promise<string | null> {
    if (!imported?.ok) return null;
    const record = {
      ...newLeagueRecord(imported.name ?? `ESPN league ${espn.leagueId}`, { ...imported.league, valueThreshold: DEFAULT_LEAGUE.valueThreshold }),
      ...(imported.draftAt ? { draftAt: imported.draftAt } : {}),
    };
    const res = await fetch(`/api/leagues/${record.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    }).catch(() => null);
    if (!res?.ok) {
      setPhase({ kind: "error", message: "Couldn't create that league. Try again, or set one up in War Room first." });
      return null;
    }
    return record.id;
  }

  async function connect() {
    setPhase({ kind: "pairing" });
    const leagueId = chosen === FROM_ESPN ? await createFromEspn() : chosen;
    if (!leagueId) return;
    const res = await fetch("/api/espn/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leagueId,
        espnLeagueId: espn.leagueId,
        espnTeamId: espn.teamId,
        season: espn.season,
        ...(acknowledged ? {} : { acknowledged: ESPN_DISCLOSURE_VERSION }),
      }),
    }).catch(() => null);
    if (!res) return setPhase({ kind: "error", message: "Couldn't reach War Room. Check your connection and try again." });
    if (res.status === 402) return setPhase({ kind: "error", message: "Live sync comes with this league's season pass.", needsPurchase: true });
    if (res.status === 403) return setPhase({ kind: "error", message: "ESPN live sync isn't available on your account yet. It's in a limited beta." });
    if (res.status === 401 || res.status === 428) return location.reload();
    if (!res.ok) return setPhase({ kind: "error", message: "Something went wrong connecting. Try again." });
    const { token } = (await res.json()) as { token: string };
    const opener = window.opener as Window | null;
    opener?.postMessage({ type: "warroom-bridge-paired", token }, ESPN_ORIGIN);
    announceEspnPaired(leagueId);
    setPhase({ kind: "done", delivered: !!opener });
    if (opener) setTimeout(() => window.close(), 1500);
  }

  const league = options.find((l) => l.id === chosen);
  // A league built here isn't in `leagues` yet, so name it from ESPN rather than from the option label.
  const connectedName = chosen === FROM_ESPN ? espnName(imported?.ok ? imported.name : undefined, espn.leagueId) : league?.name;

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
            <p className="font-semibold text-mine">Connected to {connectedName ?? "your league"}.</p>
            <p className="text-sm text-muted">
              {phase.delivered
                ? "Keep your ESPN draft tab open; picks will show up on your board. This window will close."
                : "Go back to your ESPN draft tab and click Connect there again to finish."}
            </p>
          </section>
        ) : options.length === 0 ? (
          <p className="rounded-card border border-line bg-panel p-4 text-sm">
            {imported && !imported.ok ? (
              <>
                {imported.error} <a className="text-focus underline" href="/draft" target="_blank" rel="noreferrer">Set your league up in War Room</a>, then click Connect
                in ESPN again.
              </>
            ) : (
              <>
                You don&apos;t have a War Room league yet.{" "}
                <a className="text-focus underline" href="/draft" target="_blank" rel="noreferrer">
                  Set one up
                </a>
                , then click Connect in ESPN again.
              </>
            )}
          </p>
        ) : (
          <section className="rounded-card border border-line bg-panel p-4 space-y-3">
            <label className="block text-sm">
              <span className="text-muted">Sync ESPN league {espn.leagueId} into</span>
              <select
                className="mt-1 block w-full rounded-card border border-line2 bg-panel2 px-2 py-2 text-base"
                value={chosen}
                onChange={(e) => setLeagueId(e.target.value)}
              >
                {options.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.teams} teams)
                  </option>
                ))}
              </select>
            </label>
            {chosen === FROM_ESPN && imported?.ok && (
              <p className="text-sm text-muted">
                Built from ESPN: {imported.league.teams} teams, {SCORING[imported.league.scoring]}, {imported.league.roster.length} rounds, you pick at{" "}
                {imported.league.mySlot}.
              </p>
            )}
            {!acknowledged && (
              <div className="space-y-2 rounded-card border border-line2 bg-panel2 p-3 text-sm">
                <p className="font-semibold">Before you connect</p>
                <ul className="list-disc space-y-1 pl-5 text-muted">
                  {ESPN_DISCLOSURE.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I understand</span>
                </label>
              </div>
            )}
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
              disabled={!leagueId || !agreed || phase.kind === "pairing"}
              onClick={connect}
            >
              {phase.kind === "pairing" ? "Connecting…" : "Connect"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
