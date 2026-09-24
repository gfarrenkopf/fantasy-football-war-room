"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AiLineup } from "@/lib/ai/season/lineup";
import type { SeasonAiState, StoredAiOutput } from "@/lib/ai/season/state";
import type { AiTradeWriteup } from "@/lib/ai/season/trade";
import type { Trade } from "@/lib/season/trade";
import type { LineupSlot } from "@/lib/season/types";
import type { SeasonView } from "@/lib/season/view";
import s from "./season.module.css";

/**
 * In-season AI on the season page (Epic 11): the AI lineup, the AI trade write-up, and the paywall
 * once the account's free weeks are over. The free optimal lineup and trade verdict never wait on
 * any of this, and stay whatever happens here.
 */

const SLOT_LABEL: Record<LineupSlot, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FLEX: "FLEX", SUPERFLEX: "OP", DST: "D/ST", K: "K", BN: "Bench", IR: "IR" };

type Post<T> = { ok: true; body: T } | { ok: false; status: number; error: string };

async function post<T>(url: string, body?: unknown): Promise<Post<T>> {
  const res = await fetch(url, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }).catch(() => null);
  if (!res) return { ok: false, status: 0, error: "Can't reach War Room right now. Try again in a moment." };
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  return res.ok ? { ok: true, body: json } : { ok: false, status: res.status, error: json.error ?? "Something went wrong. Try again in a moment." };
}

/** "Trial week 2 of 5", or nothing once paid. */
function TrialNote({ ai }: { ai: SeasonAiState }) {
  if (ai.access.kind !== "trial") return null;
  return (
    <span className={s.panelNote}>
      Free trial · week {ai.access.trialWeek} of {ai.access.trialWeeks}
    </span>
  );
}

/** Sends the user to Stripe for this league's season pass, and back to this page after. */
export function Paywall({ leagueId, what }: { leagueId: string; what: string }) {
  const [phase, setPhase] = useState<"idle" | "opening" | "failed">("idle");
  const [problem, setProblem] = useState("");
  async function buy() {
    setPhase("opening");
    const res = await post<{ url: string }>(`/api/leagues/${encodeURIComponent(leagueId)}/checkout?from=season`);
    if (res.ok) {
      window.location.assign(res.body.url); // stays "Opening checkout…" while the page leaves
      return;
    }
    setProblem(res.status === 409 ? "This league already has a season pass. Reload the page." : res.error);
    setPhase("failed");
  }
  return (
    <div className={s.paywall}>
      <p>
        Your free weeks of {what} are over. A season pass for this league brings back the AI lineup twice a week and trade write-ups through the playoffs.
        The recommended lineup and trade verdicts stay free.
      </p>
      <button type="button" className={s.primary} onClick={buy} disabled={phase === "opening"}>
        {phase === "opening" ? "Opening checkout…" : "Get the season pass"}
      </button>
      {phase === "failed" && <p className={s.aiError}>{problem}</p>}
    </div>
  );
}

export type CheckoutOutcome = "success" | "cancel";

/**
 * After Stripe sends the user back (`?checkout=success`, read by the page), reloads the page's data
 * every 2 seconds until the webhook has recorded the pass, for up to 30 seconds. The query is dropped
 * at once so a reload doesn't repeat the message; the outcome is held from the first render.
 */
export function useCheckoutReturn(ai: SeasonAiState | null, returned: CheckoutOutcome | null) {
  const router = useRouter();
  const [outcome] = useState(returned);
  const paid = ai?.access.kind !== "needs-purchase";
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("checkout")) return;
    url.searchParams.delete("checkout");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);
  useEffect(() => {
    if (outcome !== "success" || paid) return;
    const started = Date.now();
    const timer = setInterval(() => (Date.now() - started > 30_000 ? clearInterval(timer) : router.refresh()), 2_000);
    return () => clearInterval(timer);
  }, [outcome, paid, router]);
  if (outcome === "cancel") return "Checkout canceled. You weren't charged.";
  if (outcome === "success") return paid ? "Season pass active. Thanks!" : "Payment received. Your season pass will be active in a moment.";
  return null;
}

/** The newest of this week's AI lineups: Sunday's once it exists (11.3), else the mid-week one. */
const latest = (ai: SeasonAiState): StoredAiOutput<AiLineup> | undefined => ai.lineups["lineup-sunday"] ?? ai.lineups["lineup-midweek"];

/** The AI lineup for this week (11.2): the button that writes it, then the calls and their reasons. */
export function AiLineupCard({ leagueId, view, ai, className }: { leagueId: string; view: SeasonView; ai: SeasonAiState; className?: string }) {
  const [written, setWritten] = useState<StoredAiOutput<AiLineup> | null>(null);
  const [phase, setPhase] = useState<"idle" | "writing" | "failed">("idle");
  const [problem, setProblem] = useState("");
  const [paywalled, setPaywalled] = useState(false);
  const stored = written ?? latest(ai);
  const names = new Map((view.teams.find((t) => t.id === view.myTeamId)?.roster ?? []).map((p) => [p.playerId, p.name]));
  const name = (id: number | null) => (id === null ? "nobody" : (names.get(id) ?? `ESPN player ${id}`));

  async function write() {
    setPhase("writing");
    const res = await post<{ lineup: AiLineup; createdAt: string }>(`/api/leagues/${encodeURIComponent(leagueId)}/season/lineup`);
    if (res.ok) {
      setWritten({ output: res.body.lineup, createdAt: res.body.createdAt });
      setPhase("idle");
      return;
    }
    if (res.status === 402) setPaywalled(true);
    setProblem(res.error);
    setPhase("failed");
  }

  const calls = stored?.output.slots.filter((slot) => slot.reason) ?? [];
  const departures = stored?.output.slots.filter((slot) => slot.playerId !== slot.enginePlayerId) ?? [];
  return (
    <section className={[s.panel, className].filter(Boolean).join(" ")} aria-labelledby="ai-lineup-title">
      <div className={s.panelHead}>
        <h2 id="ai-lineup-title" className={s.panelTitle}>
          AI lineup
        </h2>
        <TrialNote ai={ai} />
      </div>
      {ai.access.kind === "needs-purchase" || paywalled ? (
        <Paywall leagueId={leagueId} what="AI lineups" />
      ) : stored ? (
        <div className={s.ai}>
          <p className={s.aiIntro}>{stored.output.intro}</p>
          {departures.length > 0 && (
            <p className={s.aiDepart} role="note">
              {departures.map((slot) => `Start ${name(slot.playerId)} over ${name(slot.enginePlayerId)} at ${SLOT_LABEL[slot.key]}`).join(". ")}: a close call the AI makes
              differently from the lineup above.
            </p>
          )}
          {calls.length > 0 && (
            <ul className={s.aiCalls}>
              {calls.map((slot, i) => (
                <li key={`${slot.key}-${i}`} className={s.aiCall}>
                  <span className={s.aiSlot}>{SLOT_LABEL[slot.key]}</span>
                  <span>
                    <b>{name(slot.playerId)}</b> <span className={s.fine}>{slot.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={s.fine} suppressHydrationWarning>
            Written {new Date(stored.createdAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} from the projections then.
          </p>
        </div>
      ) : ai.midweekUsed ? (
        <p className={`${s.note} ${s.fine}`}>This week&apos;s mid-week AI lineup is used. The Sunday one comes after the inactives are posted.</p>
      ) : (
        <div className={s.ai}>
          <p className={s.fine}>The AI talks through this week&apos;s lineup and makes the close calls: one mid-week, and one on Sunday morning after the inactives.</p>
          <button type="button" className={s.primary} onClick={write} disabled={phase === "writing"}>
            {phase === "writing" ? "Writing your lineup…" : "Write my AI lineup"}
          </button>
          {phase === "failed" && <p className={s.aiError}>{problem}</p>}
        </div>
      )}
    </section>
  );
}

const LEAN: Record<AiTradeWriteup["lean"], string> = { accept: "Accept", decline: "Decline", counter: "Counter" };

/**
 * The AI write-up of the trade in the builder (11.2). Keyed by the trade, so changing the trade
 * starts over; asking again for the same trade this week returns the stored write-up without cost.
 */
export function AiTradeWriteupCard({
  leagueId,
  view,
  ai,
  trade,
  onCounter,
}: {
  leagueId: string;
  view: SeasonView;
  ai: SeasonAiState;
  trade: Trade;
  onCounter: (trade: Trade) => void;
}) {
  const [writeup, setWriteup] = useState<AiTradeWriteup | null>(null);
  const [phase, setPhase] = useState<"idle" | "writing" | "failed">("idle");
  const [problem, setProblem] = useState("");
  const [paywalled, setPaywalled] = useState(false);
  const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  const list = (ids: number[]) => ids.map((id) => names.get(id) ?? `ESPN player ${id}`).join(", ") || "nobody";

  if (ai.access.kind === "needs-purchase" || paywalled) return <Paywall leagueId={leagueId} what="AI trade write-ups" />;

  async function write() {
    setPhase("writing");
    const res = await post<{ writeup: AiTradeWriteup }>(`/api/leagues/${encodeURIComponent(leagueId)}/season/trade`, { partner: trade.teamB, gives: trade.gives, gets: trade.gets });
    if (res.ok) {
      setWriteup(res.body.writeup);
      setPhase("idle");
      return;
    }
    if (res.status === 402) setPaywalled(true);
    setProblem(res.error);
    setPhase("failed");
  }

  if (!writeup) {
    return (
      <div className={s.aiTrade}>
        <button type="button" className={s.primary} onClick={write} disabled={phase === "writing"}>
          {phase === "writing" ? "Writing it up…" : "AI write-up of this trade"}
        </button>
        <TrialNote ai={ai} />
        {phase === "failed" && <p className={s.aiError}>{problem}</p>}
      </div>
    );
  }
  const { counter } = writeup;
  return (
    <div className={`${s.aiTrade} ${s.aiTradeDone}`} aria-live="polite">
      <p className={s.aiIntro}>
        <span className={s.lean} data-lean={writeup.lean}>
          {LEAN[writeup.lean]}
        </span>{" "}
        {writeup.summary}
      </p>
      {writeup.reasons.length > 0 && (
        <ul className={s.aiReasons}>
          {writeup.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {counter && (
        <div className={s.aiCounter}>
          <p>
            <b>Counter:</b> send {list(counter.give)}; ask for {list(counter.get)}. {counter.note}
          </p>
          <button type="button" className={s.button} onClick={() => onCounter({ teamA: trade.teamA, gives: counter.give, teamB: trade.teamB, gets: counter.get })}>
            Check this counter
          </button>
        </div>
      )}
    </div>
  );
}
