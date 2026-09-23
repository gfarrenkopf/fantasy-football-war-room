"use client";

import { useMemo } from "react";
import { myPlayers, positionCounts } from "@/lib/draft/roster";
import { bestOnBoard, computeTurnPlan, type AvailabilityResult, type PlanEntry } from "@/lib/draft/sim";
import { formatSpan } from "@/lib/draft/draftDay";
import { formatRoundPick, isMyPick, nextMyPick, roundOf } from "@/lib/draft/snake";
import { LATE_POSITIONS, type DraftPick, type Position } from "@/lib/draft/types";
import { POS_COLOR } from "./Board";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { useDraft } from "./DraftProvider";
import { PlayerCard, posLabel } from "./PlayerCard";
import { usePrefs } from "./PrefsProvider";
import { ByePanel, Fold, RosterPanel } from "./RosterPanels";
import { useDraftClock } from "./useDraftClock";
import { PHONE, useMediaQuery } from "./useMediaQuery";
import { useFlags } from "./Flags";
import { AiPlanTab, AiTurnNote, useAiPlan } from "./AiPlan";
import { LiveTurnPlans, pct } from "./LiveTurnPlans";

export interface PlanOdds {
  /** Picks the odds were computed from. */
  picks: DraftPick[];
  result: AvailabilityResult;
}

/** The Focus view: turn state and pick log, plan / best-available accordion, roster and byes. */
export function FocusView({ arrival, planOdds, planStale, onOpenAiPlan }: { arrival: number; planOdds: PlanOdds | null; planStale: boolean; onOpenAiPlan(): void }) {
  // On a phone the picking panels lead and the supporting ones fold down to their summary line.
  const fold = useMediaQuery(PHONE);
  return (
    <div className={s.focus}>
      <div className={s.fcol}>
        <HeroCard arrival={arrival} />
        <PickLog collapsible={fold} />
      </div>
      <div className={s.fcol}>
        <PlanPanel planOdds={planOdds} stale={planStale} onOpenAiPlan={onOpenAiPlan} />
        <BestAvailablePanel />
      </div>
      <div className={s.fcol}>
        <RosterPanel collapsible={fold} />
        <ByePanel collapsible={fold} />
      </div>
    </div>
  );
}

/* ================= hero ================= */

function HeroCard({ arrival }: { arrival: number }) {
  const { current: cur, total, done, onClock, next: nxt, league } = useModel();
  const { teams } = league;
  const clock = useDraftClock();

  let state: string;
  let sub: string;
  if (done) {
    state = "Draft complete";
    sub = "Undo if you need to correct a pick.";
  } else if (onClock) {
    const n2 = nextMyPick(cur + 1, league);
    state = "You're on the clock";
    sub = n2 === cur + 1 ? `Pick ${cur} now, and pick ${cur + 1} right after. Click a player to draft him.` : `Pick ${cur}.${n2 <= total ? ` Your next turn after this is pick ${n2}.` : " That's your last pick."}`;
  } else if (nxt > total) {
    state = "No picks left for you";
    sub = "Log the remaining picks as they happen.";
  } else {
    const d = nxt - cur;
    const pair = nxt + 1 <= total && isMyPick(nxt + 1, league);
    state = `${d} pick${d === 1 ? "" : "s"} until you're up`;
    sub =
      d <= 4
        ? pair
          ? `Get your two names ready — picks ${nxt} and ${nxt + 1} are yours.`
          : `Get your name ready — pick ${nxt} is yours.`
        : pair
          ? `Your next turn is picks ${nxt} and ${nxt + 1} (round ${roundOf(nxt, teams)}/${roundOf(nxt + 1, teams)}). Log each pick as it happens.`
          : `Your next turn is pick ${nxt} (round ${roundOf(nxt, teams)}). Log each pick as it happens.`;
  }

  // Track: from the start of the current wait to the end of my next turn.
  let start = cur;
  let end = Math.min(total, nxt + (isMyPick(nxt + 1, league) ? 1 : 0));
  if (onClock) end = Math.min(total, isMyPick(cur + 1, league) ? cur + 1 : cur);
  else while (start > 1 && !isMyPick(start - 1, league)) start--;

  return (
    <div className={cx("hero", !done && (onClock ? "onclock" : nxt - cur <= 4 && nxt <= total && "near"))}>
      <div className={s.heroTop}>
        <div className={s.heroNum}>{Math.min(cur, total)}</div>
        <div className={s.heroRp}>
          <b>{done ? "Draft complete" : `Round ${roundOf(cur, teams)}, pick ${((cur - 1) % teams) + 1} of ${teams}`}</b>
          <span>{done ? "" : `${cur} of ${total} overall`}</span>
        </div>
      </div>
      {clock && (
        // Before the first pick, when the league has a date: how long until the room fills.
        <div className={cx("heroClock", clock.phase === "soon" && "soon")}>
          <span>
            Draft starts <b>{clock.phase === "soon" ? `at ${clock.when}` : clock.phase === "later" ? clock.when : clock.timed ? `${clock.label} · ${clock.when}` : clock.label}</b>
          </span>
          <span className={s.heroClockLeft}>{clock.phase === "soon" ? formatSpan(clock.ms) : clock.timed ? `in ${formatSpan(clock.ms)}` : clock.label === "today" ? "" : clock.label}</span>
        </div>
      )}
      <div className={s.heroState} aria-live="polite">
        {arrival > 0 && onClock && <span key={arrival} className={s.sweep} aria-hidden="true" />}
        <b>{state}</b>
        <small>{sub}</small>
      </div>
      {!done && (
        <div className={s.track}>
          {Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i).map((n) => (
            <i key={n} className={cx(n < cur && "done", n === cur && "cur", isMyPick(n, league) && "me")} title={`pick ${n}${isMyPick(n, league) ? " (yours)" : ""}`} />
          ))}
          <span className={s.trackLabel}>
            Picks {start}–{end}: grey done, white current, green yours
          </span>
        </div>
      )}
    </div>
  );
}

/* ================= pick log ================= */

function PickLog({ collapsible }: { collapsible: boolean }) {
  const { state } = useDraft();
  const model = useModel();
  const recent = state.picks.slice(-30).map((p, i, arr) => ({ ...p, n: state.picks.length - arr.length + i + 1 })).reverse();
  return (
    // `pickLog` is a positioning hook: on mobile the focus columns flatten and this panel
    // sorts to the end, behind the plan and roster it would otherwise push down.
    <Fold collapsible={collapsible} classes={["panelGrow", "pickLog"]} title="Recent picks" meta={state.picks.length ? `${state.picks.length} made` : ""}>
      <div className={s.scroll}>
        {recent.length ? (
          recent.map((p) => {
            const pl = model.player(p.playerId);
            return (
              <div key={p.n} className={cx("lrow", p.mine && "mine")}>
                <span className={s.lrowP}>#{p.n}</span>
                <span className={s.lrowWho}>
                  {pl && <i style={{ color: POS_COLOR[pl.pos] }}>{posLabel(pl.pos)}</i>}
                  {pl?.name ?? p.label?.name ?? p.playerId}
                </span>
                <span className={s.lrowT}>{p.mine ? "you" : formatRoundPick(p.n, model.league.teams)}</span>
              </div>
            );
          })
        ) : (
          <div className={s.lrow}>
            <span />
            <span className={s.empty}>No picks logged yet.</span>
            <span />
          </div>
        )}
      </div>
    </Fold>
  );
}

/* ================= plan panel ================= */

function Accordion({ id, head, hint, children }: { id: "plan" | "ba"; head: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  const { prefs, setPrefs } = usePrefs();
  const open = prefs.center === id;
  return (
    <div className={cx("panel", "acc", open && "open")}>
      <h3 className={s.panelTitle}>
        <button className={s.accHead} onClick={() => setPrefs({ center: id })} aria-expanded={open}>
          <span className={s.chev} />
          {head}
        </button>
        {hint}
      </h3>
      <div className={s.accBody}>{children}</div>
    </div>
  );
}

function PlanPanel({ planOdds, stale, onOpenAiPlan }: { planOdds: PlanOdds | null; stale: boolean; onOpenAiPlan(): void }) {
  const model = useModel();
  const { state } = useDraft();
  const flags = useFlags();
  const { teams } = model.league;

  const plans = useMemo(() => {
    if (!planOdds) return null;
    return { now: computeTurnPlan(planOdds.picks, planOdds.result, model.ctx, 0), next: computeTurnPlan(planOdds.picks, planOdds.result, model.ctx, 1) };
  }, [planOdds, model.ctx]);

  const plan = plans?.now ?? null;
  const planIds = new Set(plan ? [...plan.targets, ...plan.fallbacks, ...plan.letGo].map((e) => e.player.id) : []);
  const counts = positionCounts(myPlayers(state.picks, model.player));
  const nowRound = roundOf(Math.min(model.current, model.total), teams);
  const board = model.done ? [] : bestOnBoard(new Set(model.taken.keys()), counts, nowRound, model.ctx, 4, planIds);
  const turnLabel = plan ? `${model.onClock ? "This turn" : "Your next turn"}: pick${plan.picks.length > 1 ? "s" : ""} ${plan.picks.join(" & ")}` : "Your turn plan";
  const rounds = plan ? [...new Set(plan.picks.map((n) => roundOf(n, teams)))].join("/") : "";

  const section = (title: string, entries: PlanEntry[], extra?: string, cls?: string) =>
    entries.length ? (
      <>
        <h5 className={cx("tgtH", cls)}>{title}</h5>
        {entries.map((e) => (
          <PlayerCard key={e.player.id} player={e.player} rank={pct(e)} extra={extra ? [extra] : []} />
        ))}
      </>
    ) : null;

  return (
    <Accordion id="plan" head={turnLabel} hint={rounds ? <span className={s.accHint}>round {rounds}</span> : undefined}>
      {!planOdds ? (
        <div className={s.planSub}>{model.next > model.total ? "No picks left for you." : "Estimating your plan…"}</div>
      ) : !plan ? (
        <div className={s.planSub}>No picks left for you.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <AiTurnNote onOpen={onOpenAiPlan} />
          <div className={s.planSub}>
            {model.onClock
              ? "The best players for your roster right now, in priority order."
              : `The best players for your roster that are likely to still be there. The rank badge is the chance each one survives to pick ${plan.picks[0]}, from ${planOdds.result.n} mocks of this room.`}
            {stale && " Updating…"}
            {!flags.aiEnabled && <span className={s.hosted}>The hosted version adds an AI-written game plan for your pick slot.</span>}
          </div>
          <div className={s.tgt}>
            {section("Targets (in priority order)", plan.targets)}
            {section("If they're gone", plan.fallbacks)}
            {section("Let go — they probably won't survive", plan.letGo, "avoid", "avoid")}
            {board.length > 0 && (
              <>
                <h5 className={cx("tgtH", "now")}>Best on the board right now, adjusted for your needs (outside the plan)</h5>
                {board.map((p) => (
                  <PlayerCard key={p.id} player={p} rank={`#${p.consensusRank}`} extra={p.adp <= model.current - teams ? ["fell"] : []} />
                ))}
              </>
            )}
          </div>
          {plans?.next && (
            <div className={s.planNext}>
              <b>After that, pick{plans.next.picks.length > 1 ? "s" : ""} {plans.next.picks.join(" & ")}:</b>{" "}
              {plans.next.targets
                .filter((e) => !model.taken.has(e.player.id))
                .map((e) => e.player.name)
                .join(", ") || "see the turn plan"}
            </div>
          )}
        </div>
      )}
    </Accordion>
  );
}

/* ================= best available ================= */

function BestAvailablePanel() {
  const model = useModel();
  const { prefs, setPrefs } = usePrefs();
  const available = model.ctx.byConsensus.filter((p) => !model.taken.has(p.id));
  const nextLate = available.filter((p) => LATE_POSITIONS.includes(p.pos)).slice(0, 4);

  const toggle = (
    <span className={cx("seg", "baToggle")}>
      {(["pos", "all"] as const).map((mode) => (
        <button key={mode} className={cx(prefs.baMode === mode && "on")} onClick={() => setPrefs({ baMode: mode, center: "ba" })}>
          {mode === "pos" ? "By position" : "Overall"}
        </button>
      ))}
    </span>
  );

  return (
    <Accordion
      id="ba"
      head="Best available"
      hint={
        <>
          {toggle}
          {/* `deskHint` marks modifier-key advice that mobile hides: there is no Cmd-click on a phone. */}
          <span className={cx("accHint", "deskHint")}>click to log the pick; Cmd/Ctrl-click or ✕ forces &quot;another team&quot;</span>
        </>
      }
    >
      <div className={cx("ba", prefs.baMode === "all" && "all")}>
        {prefs.baMode === "all"
          ? available
              .filter((p) => !LATE_POSITIONS.includes(p.pos))
              .slice(0, 36)
              .map((p) => <PlayerCard key={p.id} player={p} rank={`#${p.consensusRank}`} />)
          : (["QB", "RB", "WR", "TE"] as Position[]).map((pos) => (
              <div key={pos}>
                <h5 className={s.baH}>
                  <span className={s.dot} style={{ background: POS_COLOR[pos] }} />
                  {pos}
                </h5>
                {available
                  .filter((p) => p.pos === pos)
                  .slice(0, 8)
                  .map((p) => (
                    <PlayerCard key={p.id} player={p} />
                  ))}
              </div>
            ))}
        <div className={s.more}>
          {prefs.baMode === "all" ? "Rank badge = overall expert consensus rank. " : ""}Next K / D/ST by consensus: {nextLate.map((p) => p.name).join(", ")}. Everything
          else is on the Board view or via search.
        </div>
      </div>
    </Accordion>
  );
}

/* ================= turn plan drawer ================= */

export type PlanDrawerTab = "live" | "ai";

export function PlanDrawer({ planOdds, tab, onTab, onClose }: { planOdds: PlanOdds | null; tab: PlanDrawerTab; onTab(tab: PlanDrawerTab): void; onClose(): void }) {
  const model = useModel();
  const aiPlan = useAiPlan();
  const showing = aiPlan ? tab : "live";

  return (
    <>
      <div className={s.scrim} onClick={onClose} />
      <aside className={s.drawer} aria-label="Turn plan">
        <div className={s.drawerHead}>
          <b>Turn plan from {formatRoundPick(model.league.mySlot, model.league.teams)}</b>
          {aiPlan && (
            <span className={cx("seg", "drawerTabs")} role="tablist" aria-label="Plan">
              <button role="tab" aria-selected={showing === "live"} className={cx(showing === "live" && "on")} onClick={() => onTab("live")}>
                Live odds
              </button>
              <button role="tab" aria-selected={showing === "ai"} className={cx(showing === "ai" && "on")} onClick={() => onTab("ai")}>
                AI game plan
              </button>
            </span>
          )}
          <button className={s.btn} onClick={onClose}>
            Close
          </button>
        </div>
        {showing === "ai" ? (
          <div className={s.drawerBody}>
            <AiPlanTab planOdds={planOdds} onShowLive={() => onTab("live")} />
          </div>
        ) : (
          <div className={s.drawerBody}>
            <p>
              You pick at <b>{planOdds?.result.turns.map((t) => t.join("/")).join(", ") || "—"}</b>. Plans are rebuilt after every pick from{" "}
              {planOdds?.result.n ?? "—"} mocks of your room. % is the chance a player survives to that turn.
            </p>
            <LiveTurnPlans planOdds={planOdds} />
            <h4>Controls</h4>
            <ul>
              <li>Click a player: logs the pick for whoever is on the clock (you on your picks, another team otherwise).</li>
              <li>
                <kbd className={s.kbd}>Cmd</kbd>/<kbd className={s.kbd}>Ctrl</kbd>-click, right-click, or the <kbd className={s.kbd}>✕</kbd> button: drafted by
                another team, regardless of whose pick it is.
              </li>
              <li>
                <kbd className={s.kbd}>Shift</kbd>-click: force onto your roster (pick trades, keepers).
              </li>
              <li>
                Click a taken player to put him back. <kbd className={s.kbd}>/</kbd> focuses search, <kbd className={s.kbd}>Enter</kbd> drafts the top match,{" "}
                <kbd className={s.kbd}>Ctrl/Cmd+Z</kbd> undoes, <kbd className={s.kbd}>1</kbd>/<kbd className={s.kbd}>2</kbd> switch views.
              </li>
            </ul>
          </div>
        )}
      </aside>
    </>
  );
}
