"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SignIn } from "@/components/landing/SignIn";
import type { SeasonAiState } from "@/lib/ai/season/state";
import type { PublicFlags } from "@/lib/config";
import type { SessionUser } from "@/lib/auth/types";
import { AccountMenu, AccountProvider } from "@/components/draft/Account";
import { ConfirmProvider } from "@/components/draft/Feedback";
import { FlagsProvider } from "@/components/draft/Flags";
import { AppBar, SyncChip } from "@/components/shell/AppBar";
import { LeagueMenu } from "@/components/shell/LeagueMenu";
import type { ProjectionAccuracy } from "@/lib/season/accuracy";
import type { ArchiveWeek } from "@/lib/season/leagueRecap";
import { matchupLive, type GameDayPhase } from "@/lib/season/gameday";
import { listenForSignIn } from "@/lib/auth/channel";
import type { SeasonView } from "@/lib/season/view";
import { useCheckoutReturn, type CheckoutOutcome } from "./AiPanel";
import { ArrowLeft } from "./Icons";
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
  /** The signed-in user, for the app bar's account menu; absent when signed out. */
  user?: SessionUser;
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
      /** Last week between weeks, and ESPN's calls on it, for the recap game day keeps (APE-306). */
      previous?: { view: SeasonView; accuracy: ProjectionAccuracy | null };
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
      /** Every kept week, told for the recap archive (APE-250). */
      archive: ArchiveWeek[];
      /** ESPN's pre-game projections against the scores (APE-229), and its season on the user's team. */
      accuracy: ProjectionAccuracy | null;
    }
);

type Tab = "gameday" | "lineup" | "trade" | "waivers";

export interface SeasonLeagueLink {
  id: string;
  name: string;
}

/**
 * The season page (src/app/season/[leagueId]/page.tsx). On a desktop everything that decides the
 * week sits above the fold; on a phone the tabs move to a bar in the thumb zone.
 */
export function SeasonRoom(props: Props) {
  const phase = "view" in props ? props.phase : "lineup";
  // Game day leads while games are on or the week's result is up; between weeks the lineup does.
  const [tab, setTab] = useState<Tab>(phase === "lineup" ? "lineup" : "gameday");
  const title = "view" in props ? props.view.name : (props.leagueName ?? "Your season");
  const view = "view" in props ? props.view : null;
  const ai = "view" in props ? props.ai : null;
  const checkout = useCheckoutReturn(ai, "view" in props ? props.checkout : null);
  useLivePolling(!!view && matchupLive(view));
  const router = useRouter();
  const time = useLocalTime("view" in props ? props.fetchedAt : null);
  const offers = view ? view.pendingTrades.filter((t) => t.status === "proposed" && t.proposerTeamId !== view.myTeamId).length : 0;

  return (
    <main className={s.root}>
      <FlagsProvider flags={props.flags}>
        <AccountProvider user={props.user ?? null}>
          <ConfirmProvider>
            <AppBar
              league={
                props.user ? (
                  <LeagueMenu
                    leagues={props.leagues ?? [{ id: props.leagueId, name: title }]}
                    currentId={props.leagueId}
                    currentName={title}
                    onPick={(id) => router.push(`/season/${encodeURIComponent(id)}`)}
                  />
                ) : null
              }
              sync={"view" in props ? <SyncChip time={time} stale={props.stale} href={`/season/${props.leagueId}?refresh=1`} /> : null}
              account={props.user ? <AccountMenu /> : null}
            />
          </ConfirmProvider>
        </AccountProvider>
      </FlagsProvider>
      <div className={s.frame}>
        <header className={s.top}>
          <div className={s.titleBlock}>
            <nav className={s.crumbs} aria-label="Draft Room">
              <a href={`/draft?league=${encodeURIComponent(props.leagueId)}`} className={s.draftDoor}>
                <ArrowLeft /> Draft room
              </a>
            </nav>
            <h1 className={s.title}>{title}</h1>
            {"view" in props && <Freshness view={props.view} />}
          </div>
          {view && (
            <div className={s.tabs} role="tablist" aria-label="Season tools">
              <TabButton id="gameday" tab={tab} onSelect={setTab}>
                Game day
              </TabButton>
              <TabButton id="lineup" tab={tab} onSelect={setTab}>
                Lineup
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
              {tab === "gameday" ? (
                <GameDayPanel leagueId={props.leagueId} view={props.result ?? props.view} phase={props.phase} accuracy={props.accuracy} previous={props.previous} archive={props.archive} onLineupTools={() => setTab("lineup")} />
              ) : tab === "lineup" ? (
                <LineupPanel view={props.view} leagueId={props.leagueId} ai={props.ai} writeConsented={props.writeConsented} />
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

function TabButton({ id, tab, onSelect, children }: { id: Tab; tab: Tab; onSelect: (tab: Tab) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className={s.tab} onClick={() => onSelect(id)}>
      {children}
    </button>
  );
}

const noSubscription = () => () => {};

/** The user's week and record under the title; ESPN's sync time is the app bar's chip. */
function Freshness({ view }: { view: SeasonView }) {
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
    </p>
  );
}

/** When ESPN was last read, as the reader's local time. Formatted in the browser only: the server's time zone isn't the reader's. */
function useLocalTime(iso: string | null) {
  return useSyncExternalStore(
    noSubscription,
    () => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""),
    () => "",
  );
}

function Problem({ flags, problem, espnUrl }: { flags: PublicFlags; problem: SeasonProblem; espnUrl?: string }) {
  useEffect(() => (problem.kind === "signed-out" ? listenForSignIn(() => location.reload()) : undefined), [problem.kind]);
  if (problem.kind === "signed-out") {
    return (
      <section className={`${s.panel} ${s.note}`}>
        <SignIn flags={flags} title="Sign in to see your season" fine="Your lineup and trade help live in your Draft Room account." autoFocus />
      </section>
    );
  }
  const reconnect = espnUrl ? (
    <>
      <a className={s.link} href={espnUrl} target="_blank" rel="noopener noreferrer">
        Open your league on ESPN
      </a>
      , use your Draft Room bookmark there, then Connect my season. No bookmark on this device?{" "}
      <a className={s.link} href="/espn">
        Add it
      </a>
      .
    </>
  ) : (
    <>
      Open your league on ESPN, use the{" "}
      <a className={s.link} href="/espn">
        Draft Room bookmark
      </a>
      , then Connect my season.
    </>
  );
  const text = {
    "not-linked": <>This league isn&apos;t connected to ESPN yet. {reconnect}</>,
    "no-login": <>Draft Room needs your ESPN connection for this. {reconnect}</>,
    disconnected: <>ESPN signed Draft Room out, which it does every so often. {reconnect}</>,
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
        <p role="status">Disconnected. Draft Room has deleted your ESPN login.</p>
      ) : phase === "confirm" || phase === "working" ? (
        <p>
          Delete your ESPN login from Draft Room? Your leagues stop updating until you connect again.{" "}
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
          Draft Room reads your leagues with your ESPN login.{" "}
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
