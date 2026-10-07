"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SignIn } from "@/components/landing/SignIn";
import type { SeasonAiState } from "@/lib/ai/season/state";
import type { PublicFlags } from "@/lib/config";
import type { ProjectionAccuracy } from "@/lib/season/accuracy";
import { matchupLive, type GameDayPhase } from "@/lib/season/gameday";
import { listenForSignIn } from "@/lib/auth/channel";
import type { SeasonView } from "@/lib/season/view";
import { useCheckoutReturn, type CheckoutOutcome } from "./AiPanel";
import { ArrowLeft, ChevronDown, Refresh } from "./Icons";
import { LineupPanel } from "./LineupPanel";
import { pts, recordText } from "./parts";
import { TradePanel } from "./TradePanel";
import { GameDayPanel } from "./GameDayPanel";
import { useLivePolling } from "./useLivePolling";
import { WaiverPanel } from "./WaiverPanel";
import s from "./season.module.css";

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
  /** The user's leagues that follow ESPN (APE-194), to switch between; absent when signed out. */
  leagues?: SeasonLeagueLink[];
} & (
  | {
      problem: SeasonProblem;
      /** The league's page on ESPN, where reconnecting starts (APE-301); absent when the league isn't linked. */
      espnUrl?: string;
    }
  | {
      view: SeasonView;
      /** Last week, while its result is still up after ESPN has moved on (APE-251); game day shows it. */
      result?: SeasonView;
      fetchedAt: string;
      stale: boolean;
      projectionsMissing: boolean;
      /** In-season AI (Epic 11); null when it's off or not for this account. */
      ai: SeasonAiState | null;
      /** Stripe just sent the user back here (`?checkout=`). */
      checkout: CheckoutOutcome | null;
      /** Whether the user gets the Sunday lineup email; null when there's no such email to offer. */
      seasonEmails: boolean | null;
      /** Whether the user has agreed to War Room changing their ESPN team (12.1, Epic 13), so confirming needn't ask. */
      writeConsented: boolean;
      /** Game day (APE-227), worked out on the server when ESPN was read. */
      phase: GameDayPhase;
      /** ESPN's pre-game projections against the scores (APE-229); null off game day. */
      accuracy: ProjectionAccuracy | null;
    }
);

type Tab = "lineup" | "trade" | "waivers";

export interface SeasonLeagueLink {
  id: string;
  name: string;
}

/**
 * The season page (src/app/season/[leagueId]/page.tsx). On a desktop everything that decides the
 * week sits above the fold; on a phone the tabs move to a bar in the thumb zone.
 */
export function SeasonRoom(props: Props) {
  const [tab, setTab] = useState<Tab>("lineup");
  const title = "view" in props ? props.view.name : (props.leagueName ?? "Your season");
  const view = "view" in props ? props.view : null;
  const ai = "view" in props ? props.ai : null;
  const checkout = useCheckoutReturn(ai, "view" in props ? props.checkout : null);
  const phase = "view" in props ? props.phase : "lineup";
  // On game day the first tab is the scoreboard; the lineup tools are a tap away for players still to play.
  const [tools, setTools] = useState(false);
  useLivePolling(!!view && matchupLive(view));
  const offers = view ? view.pendingTrades.filter((t) => t.status === "proposed" && t.proposerTeamId !== view.myTeamId).length : 0;

  return (
    <main className={s.root}>
      <div className={s.frame}>
        <header className={s.top}>
          <div className={s.titleBlock}>
            <nav className={s.crumbs} aria-label="War Room">
              <a href="/draft" className={s.brand}>
                Fantasy War Room
              </a>
              <a href={`/draft?league=${encodeURIComponent(props.leagueId)}`} className={s.draftDoor}>
                <ArrowLeft /> Draft room
              </a>
            </nav>
            {props.leagues && props.leagues.length > 1 ? <LeagueSwitcher leagues={props.leagues} current={props.leagueId} title={title} /> : <h1 className={s.title}>{title}</h1>}
            {"view" in props && <Freshness view={props.view} fetchedAt={props.fetchedAt} stale={props.stale} leagueId={props.leagueId} />}
          </div>
          {view && (
            <div className={s.tabs} role="tablist" aria-label="Season tools">
              <TabButton id="lineup" tab={tab} onSelect={setTab}>
                {phase === "lineup" ? "Lineup" : "Game day"}
              </TabButton>
              <TabButton id="trade" tab={tab} onSelect={setTab}>
                Trades
                {offers > 0 && (
                  <span className={s.badge} aria-label={`${offers} waiting on you`}>
                    {offers}
                  </span>
                )}
              </TabButton>
              <TabButton id="waivers" tab={tab} onSelect={setTab}>
                Waivers
              </TabButton>
            </div>
          )}
        </header>

        {"problem" in props ? (
          <Problem flags={props.flags} problem={props.problem} espnUrl={props.espnUrl} />
        ) : (
          <>
            {checkout && (
              <p className={`${s.panel} ${s.note} ${s.banner}`} role="status">
                {checkout}
              </p>
            )}
            {props.projectionsMissing && (
              <p className={`${s.panel} ${s.note} ${s.metaStale} ${s.banner}`} role="status">
                ESPN&apos;s projections didn&apos;t load, so every player shows 0. Refresh in a minute.
              </p>
            )}
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === "lineup" && props.phase !== "lineup" && !tools ? (
                <GameDayPanel leagueId={props.leagueId} view={props.result ?? props.view} phase={props.phase} accuracy={props.accuracy} onLineupTools={() => setTools(true)} />
              ) : tab === "lineup" ? (
                <>
                  {props.phase !== "lineup" && (
                    <button type="button" className={`${s.button} ${s.backToGame}`} onClick={() => setTools(false)}>
                      Back to game day
                    </button>
                  )}
                  <LineupPanel view={props.view} leagueId={props.leagueId} ai={props.ai} writeConsented={props.writeConsented} />
                </>
              ) : tab === "trade" ? (
                <TradePanel view={props.view} leagueId={props.leagueId} ai={props.ai} writeConsented={props.writeConsented} />
              ) : (
                <WaiverPanel view={props.view} leagueId={props.leagueId} writeConsented={props.writeConsented} />
              )}
            </div>
            <Disconnect seasonEmails={props.seasonEmails} />
          </>
        )}
      </div>
    </main>
  );
}

/**
 * The page title, as a menu of the user's ESPN-linked leagues: picking one opens its season page.
 * The select sits over the title, so it reads as the heading and opens as a native menu everywhere.
 */
function LeagueSwitcher({ leagues, current, title }: { leagues: SeasonLeagueLink[]; current: string; title: string }) {
  const router = useRouter();
  return (
    <h1 className={`${s.title} ${s.switcher}`}>
      <span className={s.switcherLabel} aria-hidden>
        {title}
        <ChevronDown />
      </span>
      <select
        className={s.switcherSelect}
        aria-label="League"
        value={current}
        onChange={(e) => router.push(`/season/${encodeURIComponent(e.target.value)}`)}
      >
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </h1>
  );
}

function TabButton({ id, tab, onSelect, children }: { id: Tab; tab: Tab; onSelect: (tab: Tab) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className={s.tab} onClick={() => onSelect(id)}>
      {children}
    </button>
  );
}

const noSubscription = () => () => {};

function Freshness({ view, fetchedAt, stale, leagueId }: { view: SeasonView; fetchedAt: string; stale: boolean; leagueId: string }) {
  // Formatted in the browser only: the server's time zone isn't the reader's.
  const time = useSyncExternalStore(
    noSubscription,
    () => new Date(fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    () => "",
  );
  const standing = view.teams.find((t) => t.id === view.myTeamId)?.standing;
  return (
    <p className={s.meta}>
      <span>Week {view.currentWeek}</span>
      {standing && (
        <span className={s.metaStanding}>
          <b>{recordText(standing, view.teams.length)}</b> · <span className="tabular-nums">{pts(standing.pointsFor)}</span> for,{" "}
          <span className="tabular-nums">{pts(standing.pointsAgainst)}</span> against
        </span>
      )}
      <span className={stale ? s.metaStale : undefined}>
        {stale ? "ESPN isn't answering; showing your last sync" : "Synced with ESPN"}
        {time && ` at ${time}`}
      </span>
      <a className={s.refresh} href={`/season/${leagueId}?refresh=1`}>
        <Refresh /> Refresh
      </a>
    </p>
  );
}

function Problem({ flags, problem, espnUrl }: { flags: PublicFlags; problem: SeasonProblem; espnUrl?: string }) {
  useEffect(() => (problem.kind === "signed-out" ? listenForSignIn(() => location.reload()) : undefined), [problem.kind]);
  if (problem.kind === "signed-out") {
    return (
      <section className={`${s.panel} ${s.note}`}>
        <SignIn flags={flags} title="Sign in to see your season" fine="Your lineup and trade help live in your War Room account." autoFocus />
      </section>
    );
  }
  const reconnect = espnUrl ? (
    <>
      <a className={s.link} href={espnUrl} target="_blank" rel="noopener noreferrer">
        Open your league on ESPN
      </a>
      , use your War Room bookmark there, then Connect my season. No bookmark on this device?{" "}
      <a className={s.link} href="/espn">
        Add it
      </a>
      .
    </>
  ) : (
    <>
      Open your league on ESPN, use the{" "}
      <a className={s.link} href="/espn">
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
    <p className={`${s.panel} ${s.note}`} role="status">
      {text}
    </p>
  );
}

/** Deletes the stored ESPN login (10.2). Every connected league stops updating until the user reconnects. */
function Disconnect({ seasonEmails }: { seasonEmails: boolean | null }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "working" | "done" | "failed">("idle");
  async function disconnect() {
    setPhase("working");
    const res = await fetch("/api/espn/login", { method: "DELETE" }).catch(() => null);
    setPhase(res?.ok ? "done" : "failed");
  }
  return (
    <footer className={s.footer}>
      {phase === "done" ? (
        <p role="status">Disconnected. War Room has deleted your ESPN login.</p>
      ) : phase === "confirm" || phase === "working" ? (
        <p>
          Delete your ESPN login from War Room? Your leagues stop updating until you connect again.{" "}
          <button type="button" className={`${s.textButton} ${s.danger}`} disabled={phase === "working"} onClick={disconnect}>
            Disconnect ESPN
          </button>{" "}
          ·{" "}
          <button type="button" className={s.textButton} onClick={() => setPhase("idle")}>
            Keep it
          </button>
        </p>
      ) : (
        <p>
          War Room reads your leagues with your ESPN login.{" "}
          <button type="button" className={s.textButton} onClick={() => setPhase("confirm")}>
            Disconnect ESPN
          </button>
          {phase === "failed" && <span className={s.metaStale}> Couldn&apos;t disconnect. Try again.</span>}
        </p>
      )}
      {seasonEmails !== null && <SeasonEmails initial={seasonEmails} />}
    </footer>
  );
}

/** The Sunday job's email (11.3): on unless the user turns it off here or from the email. */
function SeasonEmails({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [failed, setFailed] = useState(false);
  async function toggle(next: boolean) {
    setOn(next);
    setFailed(false);
    const res = await fetch("/api/season/emails", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: next }) }).catch(() => null);
    if (!res?.ok) {
      setOn(!next);
      setFailed(true);
    }
  }
  return (
    <p>
      <label className={s.check}>
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> Email me when my Sunday AI lineup is ready
      </label>
      {failed && <span className={s.metaStale}> Couldn&apos;t save that. Try again.</span>}
    </p>
  );
}
