"use client";

import { createContext, useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import type { AiPlanTurn } from "@/lib/ai/planSchema";
import { FREE_REGENERATIONS, isWorking, nextPollDelay, planFallback, type FallbackReason, type PlanView } from "@/lib/ai/planView";
import { roundOf } from "@/lib/draft/snake";
import { getStores, type AiPlanResult } from "@/lib/storage";
import { useAccount } from "./Account";
import { BuySeasonPass, isAwaitingPass, passArrived } from "./Checkout";
import { POS_COLOR } from "./Board";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { useToast } from "./Feedback";
import type { PlanOdds } from "./FocusView";
import { useFlags } from "./Flags";
import { useLeague } from "./LeagueProvider";
import { LiveTurnPlans } from "./LiveTurnPlans";

/* ================= state ================= */

interface AiPlanValue {
  /** Null until the first status read. */
  view: PlanView | null;
  /** A request is being sent (syncing league edits, then asking). */
  sending: boolean;
  /** Why the last request or poll couldn't reach a result, for the user. */
  problem: string | null;
  /** Seconds the current job has been waiting or running. */
  waitingSeconds: number;
  /** The league needs a season pass, and the user just paid for it: waiting for the purchase to be recorded. */
  awaitingPass: boolean;
  /** Asks for a plan for the current settings, or with `regenerate`, a new version of an up-to-date one. */
  request(regenerate?: boolean): void;
}

const AiPlanContext = createContext<AiPlanValue | null>(null);

/** The AI plan for the active league, or null when AI plans aren't available here. */
export const useAiPlan = () => useContext(AiPlanContext);

/** How often, and how many times, to look for a season pass after returning from checkout. */
const PASS_CHECK_MS = 2_000;
const PASS_CHECKS = 15;

const PROBLEMS: Record<Exclude<AiPlanResult, { ok: true }>["reason"], string> = {
  offline: "Can't reach the server right now. Your league is saved on this device; try again in a moment.",
  "signed-out": "Sign in again to write a game plan.",
  unavailable: "AI game plans aren't available on this account yet.",
  "not-found": "This league isn't in your account yet. Give it a moment to sync, then try again.",
  "invalid-league": "These league settings don't fit the player data.",
};

/**
 * Loads the active league's AI plan and follows its background job: reads the status on mount (which
 * also resumes a job a reload or restart interrupted), polls while the job runs and the tab is
 * visible, and toasts when it finishes. Renders children unchanged when AI plans are off.
 */
export function AiPlanProvider({ leagueId, children }: { leagueId: string | null; children: React.ReactNode }) {
  const flags = useFlags();
  const user = useAccount();
  const store = getStores().aiPlan;
  const enabled = flags.aiEnabled && !!user && !!store && !!leagueId;
  if (!enabled) return <>{children}</>;
  return (
    <AiPlanTracker key={leagueId} leagueId={leagueId!}>
      {children}
    </AiPlanTracker>
  );
}

function AiPlanTracker({ leagueId, children }: { leagueId: string; children: React.ReactNode }) {
  const store = getStores().aiPlan!;
  const toast = useToast();
  const [view, setView] = useState<PlanView | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Only announce a finish this page actually watched happen, not a plan that was already there. */
  const watched = useRef(false);

  /** Takes in a status read or request result. Called from effects (via the events below) and click handlers. */
  function handle(result: AiPlanResult) {
    if (!result.ok) {
      setProblem(result.message ?? PROBLEMS[result.reason]);
      return;
    }
    setProblem(null);
    const next = result.view;
    if (view?.needsPurchase && !next.needsPurchase) toast("Season pass unlocked");
    if (next.limitReached) toast("You've used this league's free rewrites, so your saved plan was kept");
    if (isWorking(next)) watched.current = true;
    else if (watched.current) {
      watched.current = false;
      if (next.status === "ready") toast("Your AI game plan is ready");
      if (next.status === "failed") toast("Couldn't write your game plan");
    }
    setView(next);
  }
  const pollNow = useEffectEvent(() => void store.get(leagueId).then(handle));
  const tickNow = useEffectEvent(() => setNow(Date.now()));

  useEffect(() => {
    pollNow();
  }, [leagueId]);

  // Back from paying: Stripe's webhook usually lands within seconds of the redirect, so check again until the pass shows up.
  const [passChecks, setPassChecks] = useState(0);
  const awaitingPass = !!view?.needsPurchase && isAwaitingPass(leagueId) && passChecks < PASS_CHECKS;
  useEffect(() => {
    if (view && (!view.needsPurchase || passChecks >= PASS_CHECKS)) passArrived(leagueId);
  }, [view, passChecks, leagueId]);

  // Poll while a job is waiting or running. Paused in background tabs; resumes as soon as the tab is visible.
  const since = view?.startedAt ?? view?.requestedAt ?? null;
  const waitingMs = since ? Math.max(0, now - Date.parse(since)) : 0;
  const delay = view ? (awaitingPass ? PASS_CHECK_MS : nextPollDelay(view, waitingMs)) : null;
  useEffect(() => {
    if (delay === null) return;
    const tick = setInterval(tickNow, 1000);
    const timer = setTimeout(() => {
      if (awaitingPass) setPassChecks((n) => n + 1);
      if (document.visibilityState === "visible") pollNow();
      else tickNow(); // re-arms this effect, so the next tick while visible polls
    }, delay);
    const onVisible = () => {
      if (document.visibilityState === "visible") pollNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [delay, view, awaitingPass]);

  function request(regenerate = false) {
    setSending(true);
    setProblem(null);
    void store
      .request(leagueId, { regenerate })
      .then(handle)
      .finally(() => {
        setNow(Date.now());
        setSending(false);
      });
  }

  const value: AiPlanValue = {
    view,
    sending,
    problem,
    waitingSeconds: Math.floor(waitingMs / 1000),
    awaitingPass,
    request,
  };
  return <AiPlanContext.Provider value={value}>{children}</AiPlanContext.Provider>;
}

/* ================= pieces ================= */

/** A player from the plan: colored by position, struck through once drafted. */
function PlanName({ id }: { id: string }) {
  const model = useModel();
  const player = model.player(id);
  if (!player) return null; // no longer in the player data
  const taken = model.taken.get(id);
  return (
    <span style={{ color: POS_COLOR[player.pos] }}>
      {taken ? <span className={s.struck}>{player.name}</span> : player.name}
      {taken?.mine ? " ✓" : ""}
    </span>
  );
}

function names(ids: string[]) {
  return ids.map((id, i) => [i > 0 && ", ", <PlanName key={id} id={id} />]);
}

/** The plan's turn for the user's current or next pick. */
function currentTurn(turns: AiPlanTurn[], next: number): AiPlanTurn | null {
  return turns.find((t) => t.picks.includes(next)) ?? null;
}

function Progress({ plan }: { plan: AiPlanValue }) {
  const { view, waitingSeconds } = plan;
  if (!view) return null;
  const queued = view.status === "queued";
  const stage = queued
    ? `Waiting for a free writer${view.queuePosition ? ` (${view.queuePosition === 1 ? "next up" : `#${view.queuePosition} in line`})` : ""}…`
    : waitingSeconds < 6
      ? "Simulating mock drafts of your room…"
      : "Writing your plan, turn by turn…";
  return (
    <div className={s.aiProgress} role="status" aria-live="polite">
      <span className={s.aiSpinner} aria-hidden />
      <div>
        <b>{stage}</b>
        <div className={s.lbl}>
          {Math.floor(waitingSeconds / 60)}:{String(waitingSeconds % 60).padStart(2, "0")} · usually about a minute. Keep drafting; we&apos;ll let you know.
        </div>
      </div>
    </div>
  );
}

/** Why a job failed, for the user. */
function failureText(kind: string): string {
  switch (kind) {
    case "invalid_league":
      return "These league settings don't fit the player data.";
    case "timeout":
      return "The AI took too long this time.";
    case "unavailable":
      return "The AI service is down or didn't respond.";
    default:
      return "The AI didn't produce a usable plan this time.";
  }
}

const FALLBACK_TEXT: Record<FallbackReason, string> = {
  failed: "Until then, here's the live turn plan",
  unreachable: "While the AI plan is out of reach, here's the live turn plan",
  slow: "This is taking longer than usual. Meanwhile, here's the live turn plan",
  writing: "While yours is written, here's the live turn plan",
};

/* ================= drawer tab ================= */

/**
 * The "AI game plan" tab of the plan drawer. Whenever there's no AI plan to show (it's being written,
 * it failed, or the server can't be reached) the live turn plan fills in, so the tab is never a dead end.
 */
export function AiPlanTab({ planOdds, onShowLive }: { planOdds: PlanOdds | null; onShowLive(): void }) {
  const plan = useAiPlan();
  const model = useModel();
  const { active } = useLeague();
  if (!plan) return null;
  const { view, sending, problem, request, waitingSeconds } = plan;
  const working = !!view && isWorking(view);
  const stored = view?.plan ?? null;
  const fallback = planFallback(view, problem !== null, waitingSeconds * 1000);
  const mocks = planOdds ? ` from ${planOdds.result.n} mocks of your room` : "";

  const left = view?.regenerationsLeft ?? null;
  /** A new plan for a league that already has one uses up a rewrite; none are left. */
  const outOfRewrites = !!stored && left === 0;
  const rewrites = left === null ? "" : ` (${left} left)`;
  const button = (label: string, { regenerate = false, counted = !!stored } = {}) =>
    counted && outOfRewrites ? (
      <div className={s.lbl}>You&apos;ve used this league&apos;s free rewrites. The live turn plan keeps updating after every pick.</div>
    ) : (
      <button className={cx("btn", "primary")} onClick={() => request(regenerate)} disabled={sending || working}>
        {sending ? "Starting…" : `${label}${counted ? rewrites : ""}`}
      </button>
    );

  return (
    <div className={s.aiPlan}>
      {!view && <p>Loading your game plan…</p>}

      {view?.needsPurchase && (
        <>
          <div className={s.aiCallout}>
            <p>
              An AI analyst writes a game plan for your draft slot: who to target at each of your turns, who to fall back on, and who not to count on, from 300
              mock drafts of your room.
            </p>
            {active && !plan.awaitingPass && <BuySeasonPass leagueId={active.id} label="Unlock with a season pass" />}
            <div className={s.lbl}>
              {plan.awaitingPass
                ? "Payment received. Unlocking your game plan…"
                : `One payment for this league, this season: your plan plus ${FREE_REGENERATIONS} rewrites. The board, mock drafts and live odds stay free.`}
            </div>
          </div>
          <p className={s.aiFallback}>Meanwhile, here&apos;s the live turn plan{mocks}. % is the chance a player survives to that turn.</p>
          <LiveTurnPlans planOdds={planOdds} />
        </>
      )}

      {view?.status === "none" && (
        <div className={s.aiCallout}>
          <p>
            An AI analyst writes a game plan for your draft slot: who to target at each of your turns, who to fall back on, and who not to count on, from 300
            mock drafts of your room.
          </p>
          {button("Write my game plan", { counted: false })}
          <div className={s.lbl}>Takes about a minute. You can keep drafting while it&apos;s written.</div>
        </div>
      )}

      {working && <Progress plan={plan} />}

      {view?.status === "failed" && view.error && (
        <div className={cx("aiCallout", "aiFailed")}>
          <p>
            <b>Couldn&apos;t write your game plan.</b>{" "}
            {failureText(view.error.kind)}
            {stored && " Your previous plan is below."}
          </p>
          {view.error.retryable && button("Try again")}
        </div>
      )}

      {stored && view?.stale && !working && (
        <div className={cx("aiCallout", "aiStale")}>
          <p>Your league settings changed since this plan was written, so its picks may not line up.{outOfRewrites && " Switch to Live odds for a plan that fits them."}</p>
          {button("Rewrite for my current settings")}
        </div>
      )}

      {problem && <p className={s.aiProblem}>{problem}</p>}

      {fallback && stored && (
        <p className={s.lbl}>
          The live turn plan{mocks} is always up to date.{" "}
          <button className={s.linkBtn} onClick={onShowLive}>
            Show live odds
          </button>
        </p>
      )}
      {fallback && !stored && (
        <>
          <p className={s.aiFallback}>
            {FALLBACK_TEXT[fallback]}
            {mocks}. % is the chance a player survives to that turn.
          </p>
          <LiveTurnPlans planOdds={planOdds} />
        </>
      )}

      {stored && (
        <>
          <p className={s.aiIntro}>{stored.intro}</p>
          {stored.turns.map((turn) => {
            const now = turn.picks.includes(model.next);
            return (
              <section key={turn.picks[0]} className={cx("planSection", now && "now")}>
                <h4>
                  Pick{turn.picks.length > 1 ? "s" : ""} {turn.picks.join(" & ")}{" "}
                  <span className={s.lbl}>round {[...new Set(turn.picks.map((n) => roundOf(n, model.league.teams)))].join("/")}</span>
                </h4>
                {turn.note && <p>{turn.note}</p>}
                <ul>
                  <li>
                    <b>Targets:</b> {names(turn.targets)}
                  </li>
                  {turn.fallbacks.length > 0 && (
                    <li>
                      <b>Fallbacks:</b> {names(turn.fallbacks)}
                    </li>
                  )}
                  {turn.letGo.length > 0 && (
                    <li>
                      <b>Let go:</b> {names(turn.letGo)}
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
          {view?.generatedAt && <p className={s.lbl}>Written {new Date(view.generatedAt).toLocaleString()}.</p>}
          {view?.status === "ready" && !view.stale && (
            <div className={s.aiCallout}>
              <div className={s.lbl}>Want a different take? A new version replaces this one.</div>
              {button("Write a new version", { regenerate: true })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ================= focus panel note ================= */

/**
 * The AI plan's take on the user's current or next turn, shown above the live odds in the Focus
 * plan panel. While a plan is being written, a one-line status instead.
 */
export function AiTurnNote({ onOpen }: { onOpen(): void }) {
  const plan = useAiPlan();
  const model = useModel();
  if (!plan?.view) return null;
  const { view } = plan;

  if (isWorking(view)) {
    return (
      <div className={s.aiTurn}>
        <span className={s.aiSpinner} aria-hidden /> Writing your AI game plan…
      </div>
    );
  }
  const turn = view.plan && !view.stale ? currentTurn(view.plan.turns, model.next) : null;
  if (!turn) {
    if (view.status !== "failed") return null;
    return (
      <div className={cx("aiTurn", "lbl")}>
        AI game plan unavailable; the live plan below still works.{" "}
        <button className={s.linkBtn} onClick={onOpen}>
          Details
        </button>
      </div>
    );
  }
  return (
    <div className={s.aiTurn}>
      <div>
        <b>AI plan:</b> {turn.note}
      </div>
      <div>
        <b>Targets:</b> {names(turn.targets)}{" "}
        <button className={s.linkBtn} onClick={onOpen}>
          Full plan
        </button>
      </div>
    </div>
  );
}
