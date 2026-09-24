"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { SignIn } from "@/components/landing/SignIn";
import type { PublicFlags } from "@/lib/config";
import { listenForSignIn } from "@/lib/auth/channel";
import type { SeasonView } from "@/lib/season/view";
import { LineupPanel } from "./LineupPanel";

/** Why the page can't show a league, from the server's SeasonLoad. */
export type SeasonProblem =
  | { kind: "signed-out" }
  | { kind: "not-linked" }
  | { kind: "no-login" }
  | { kind: "disconnected" }
  | { kind: "unavailable" }
  | { kind: "invalid"; error: string };

type Props = {
  flags: PublicFlags;
  leagueId: string;
  leagueName?: string;
} & ({ problem: SeasonProblem } | { view: SeasonView; fetchedAt: string; stale: boolean; projectionsMissing: boolean });

/** The season page (src/app/season/[leagueId]/page.tsx). */
export function SeasonRoom(props: Props) {
  const title = "view" in props ? props.view.name : (props.leagueName ?? "Your season");
  return (
    <main className="min-h-dvh bg-bg text-text px-4 py-5 font-sans">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted">
            <a href="/draft" className="hover:text-text">
              Fantasy War Room
            </a>
          </p>
          <h1 className="text-xl font-semibold">{title}</h1>
          {"view" in props && <Freshness view={props.view} fetchedAt={props.fetchedAt} stale={props.stale} leagueId={props.leagueId} />}
        </header>

        {"problem" in props ? (
          <Problem flags={props.flags} problem={props.problem} />
        ) : (
          <>
            {props.projectionsMissing && (
              <p className="rounded-card border border-warn/40 bg-panel p-3 text-sm text-warn-ink" role="status">
                ESPN&apos;s projections didn&apos;t load, so every player shows 0. Refresh in a minute.
              </p>
            )}
            <LineupPanel view={props.view} />
            <Disconnect />
          </>
        )}
      </div>
    </main>
  );
}

function Freshness({ view, fetchedAt, stale, leagueId }: { view: SeasonView; fetchedAt: string; stale: boolean; leagueId: string }) {
  // Formatted in the browser only: the server's time zone isn't the reader's.
  const time = useSyncExternalStore(
    noSubscription,
    () => new Date(fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    () => "",
  );
  return (
    <p className="text-sm text-muted">
      Week {view.currentWeek} · {time ? `rosters from ESPN at ${time}` : "rosters from ESPN"}
      {stale && <span className="text-warn-ink"> (ESPN isn&apos;t answering, so these may be out of date)</span>} ·{" "}
      <a className="text-focus underline" href={`/season/${leagueId}?refresh=1`}>
        Refresh
      </a>
    </p>
  );
}

const noSubscription = () => () => {};

function Problem({ flags, problem }: { flags: PublicFlags; problem: SeasonProblem }) {
  useEffect(() => (problem.kind === "signed-out" ? listenForSignIn(() => location.reload()) : undefined), [problem.kind]);
  if (problem.kind === "signed-out") {
    return (
      <section className="rounded-card border border-line bg-panel p-4">
        <SignIn flags={flags} title="Sign in to see your season" fine="Your lineup and trade help live in your War Room account." autoFocus />
      </section>
    );
  }
  const reconnect = (
    <>
      Open your league on ESPN and click the{" "}
      <a className="text-focus underline" href="/espn">
        War Room bookmark
      </a>
      , then Connect my season.
    </>
  );
  const text = {
    "not-linked": <>This league isn&apos;t connected to ESPN yet. {reconnect}</>,
    "no-login": <>War Room needs your ESPN connection for this. {reconnect}</>,
    disconnected: <>ESPN signed War Room out, which it does every so often. {reconnect}</>,
    unavailable: <>Couldn&apos;t reach ESPN just now. Try again in a minute.</>,
    invalid: <>{problem.kind === "invalid" ? problem.error : ""}</>,
  }[problem.kind];
  return (
    <p className="rounded-card border border-line bg-panel p-4 text-sm" role="status">
      {text}
    </p>
  );
}

/** Deletes the stored ESPN login (10.2). Every connected league stops updating until the user reconnects. */
function Disconnect() {
  const [phase, setPhase] = useState<"idle" | "confirm" | "working" | "done" | "failed">("idle");
  async function disconnect() {
    setPhase("working");
    const res = await fetch("/api/espn/login", { method: "DELETE" }).catch(() => null);
    setPhase(res?.ok ? "done" : "failed");
  }
  return (
    <footer className="border-t border-line pt-3 text-sm text-muted">
      {phase === "done" ? (
        <p role="status">Disconnected. War Room has deleted your ESPN login.</p>
      ) : phase === "confirm" || phase === "working" ? (
        <p>
          Delete your ESPN login from War Room? Your leagues stop updating until you connect again.{" "}
          <button type="button" className="text-reach-ink underline" disabled={phase === "working"} onClick={disconnect}>
            Disconnect
          </button>{" "}
          <button type="button" className="underline" onClick={() => setPhase("idle")}>
            Cancel
          </button>
        </p>
      ) : (
        <p>
          Connected to ESPN.{" "}
          <button type="button" className="underline hover:text-text" onClick={() => setPhase("confirm")}>
            Disconnect
          </button>
          {phase === "failed" && <span className="text-warn-ink"> Couldn&apos;t disconnect. Try again.</span>}
        </p>
      )}
    </footer>
  );
}
