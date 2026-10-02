"use client";

import { useState } from "react";
import type { SeasonAiState, StoredAiOutput } from "@/lib/ai/season/state";
import type { AiTradeIdeas, TradeIdea } from "@/lib/ai/season/tradeIdeas";
import { snapshotOf } from "@/lib/season/apply";
import type { Trade } from "@/lib/season/trade";
import { ideaStatus, type IdeaKind } from "@/lib/season/tradeIdeas";
import type { SeasonView } from "@/lib/season/view";
import { Paywall, post, TrialNote } from "./AiPanel";
import { signed } from "./parts";
import s from "./season.module.css";
import { TradeGain, teamName } from "./TradeGain";
import { TradeWrite } from "./TradeWrite";

/**
 * Trade ideas (APE-222): two trades a week the user could offer, found by searching every roster in
 * the league and written up by the AI. A win-win the partner has a reason to take, and a bolder swing
 * that costs them a little. The engine picked the trades and the numbers; the page grades each one
 * again live, because rosters move during the week.
 */

const KIND: Record<IdeaKind, string> = { safe: "Win-win", bold: "Bold swing" };
const MISSING: Record<IdeaKind, string> = {
  safe: "No win-win this week: every trade that helps you costs the other team.",
  bold: "No bolder swing this week that a partner would plausibly take.",
};
/** The idea's numbers have moved enough since it was found that the card says so. */
const MOVED = 0.5;

export const ideaId = (kind: IdeaKind) => `idea:${kind}`;

export function TradeIdeas({
  view,
  leagueId,
  ai,
  writeConsented,
  loadedId,
  onLoad,
  onNotice,
}: {
  view: SeasonView;
  leagueId: string;
  ai: SeasonAiState;
  writeConsented: boolean;
  /** Which trade, if any, is open in the builder. */
  loadedId: string | null;
  onLoad: (trade: Trade, id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [stored, setStored] = useState<StoredAiOutput<AiTradeIdeas> | null>(ai.tradeIdeas);
  const [phase, setPhase] = useState<"idle" | "finding" | "none" | "used" | "failed">("idle");
  const [problem, setProblem] = useState("");
  const [paywalled, setPaywalled] = useState(false);

  // After the deadline there's nothing to find; the deadline note above already says why.
  if (!stored && view.tradeDeadlinePassed) return null;

  async function find() {
    setPhase("finding");
    const res = await post<{ ideas: AiTradeIdeas | null; createdAt?: string }>(`/api/leagues/${encodeURIComponent(leagueId)}/season/trade-ideas`);
    if (res.ok && res.body.ideas && res.body.createdAt) {
      setStored({ output: res.body.ideas, createdAt: res.body.createdAt });
      setPhase("idle");
      return;
    }
    if (res.ok) return setPhase("none");
    if (res.status === 402) return setPaywalled(true);
    setProblem(res.error);
    setPhase(res.status === 409 ? "used" : "failed");
  }

  const head = (
    <div className={s.columnHead}>
      <h2 id="ideas-title" className={s.columnTitle}>
        Trade ideas
      </h2>
      {stored ? <span className={s.panelNote}>Week {view.currentWeek}</span> : <TrialNote ai={ai} />}
    </div>
  );

  if (!stored && (ai.access.kind === "needs-purchase" || paywalled)) {
    return (
      <section className={s.column} aria-labelledby="ideas-title">
        {head}
        <div className={s.panel}>
          <Paywall leagueId={leagueId} what="trade ideas" />
        </div>
      </section>
    );
  }

  if (!stored) {
    const finding = phase === "finding";
    return (
      <section className={s.column} aria-labelledby="ideas-title">
        {head}
        <div className={`${s.panel} ${s.ideasFind}`}>
          <p>
            {phase === "none"
              ? "No trade clears the bar this week: none gains you points without costing the other team more than half a point a week. Rosters change after waivers, and searching again is free."
              : "Two trades a week, picked from every roster in the league: a win-win, and a bolder swing."}
          </p>
          <div className={s.ideasActions}>
            <button type="button" className={phase === "none" ? s.button : s.primary} onClick={find} disabled={finding}>
              {finding ? "Finding trades…" : phase === "none" ? "Search again" : "Find trades"}
            </button>
            <p className={s.fine} aria-live="polite">
              {finding ? "Checking every roster, then writing them up. Up to a minute." : ""}
            </p>
          </div>
          {(phase === "failed" || phase === "used") && (
            <p className={s.aiError} role="alert">
              {problem}
            </p>
          )}
        </div>
      </section>
    );
  }

  const { ideas, missing } = stored.output;
  const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  return (
    <section className={s.column} aria-labelledby="ideas-title">
      {head}
      <ul className={s.pending}>
        {ideas.map((idea) => (
          <IdeaCard
            key={idea.kind}
            view={view}
            leagueId={leagueId}
            agreed={writeConsented}
            idea={idea}
            names={names}
            active={loadedId === ideaId(idea.kind)}
            onLoad={onLoad}
            onNotice={onNotice}
          />
        ))}
      </ul>
      {missing.map((kind) => (
        <p key={kind} className={s.fine}>
          {MISSING[kind]}
        </p>
      ))}
    </section>
  );
}

function IdeaCard({
  view,
  leagueId,
  agreed,
  idea,
  names,
  active,
  onLoad,
  onNotice,
}: {
  view: SeasonView;
  leagueId: string;
  agreed: boolean;
  idea: TradeIdea;
  names: Map<number, string>;
  active: boolean;
  onLoad: (trade: Trade, id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [offering, setOffering] = useState(false);
  const [copied, setCopied] = useState(false);
  const trade: Trade = { teamA: view.myTeamId, gives: idea.gives, teamB: idea.partner, gets: idea.gets };
  const status = ideaStatus(view, trade);
  const partner = teamName(view, idea.partner);
  const list = (ids: readonly number[]) => ids.map((id) => names.get(id) ?? idea.names[id] ?? `ESPN player ${id}`).join(", ");
  const verdict = status.kind === "stale" ? null : status.verdict;
  const moved = verdict && Math.abs(verdict.a.perWeek - idea.found.you) >= MOVED;
  const canOffer = !view.tradeDeadlinePassed && status.kind !== "offered";

  async function copy() {
    try {
      await navigator.clipboard.writeText(idea.pitch);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <li className={s.offer} data-active={active} data-stale={status.kind === "stale"}>
      <div className={s.offerHead}>
        <h3 className={s.offerTitle}>
          <span className={s.offerKind} data-kind={idea.kind}>
            {KIND[idea.kind]}
          </span>
          {partner}
        </h3>
      </div>
      <dl className={s.sides}>
        <dt>You get</dt>
        <dd>{list(idea.gets)}</dd>
        <dt>You send</dt>
        <dd>{list(idea.gives)}</dd>
      </dl>

      {status.kind === "stale" ? (
        <p className={s.fine}>
          {list(status.missing)} {status.missing.length === 1 ? "isn't" : "aren't"} on those rosters any more, so this one has passed.
        </p>
      ) : active ? (
        // Open in the builder, which grades it; a second verdict here would only repeat it.
        <p className={`${s.offerOpen} ${s.fine}`}>Graded in the builder. Change either side to make it your own.</p>
      ) : (
        verdict && (
          <>
            <TradeGain verdict={verdict} partner={partner} compact inline />
            {moved && (
              <p className={`${s.fine} ${s.ideaMoved}`}>
                Numbers moved since it was found: <span className="tabular-nums">{signed(idea.found.you)}</span> →{" "}
                <span className="tabular-nums">{signed(verdict.a.perWeek)}</span> a week for you.
              </p>
            )}
          </>
        )
      )}

      <p className={s.ideaWhy}>{idea.why}</p>
      {idea.pitch && (
        <figure className={s.ideaNote}>
          <figcaption className={s.ideaNoteHead}>
            <span>Note to {partner}</span>
            {status.kind !== "stale" && (
              <button type="button" className={s.textButton} onClick={copy}>
                {copied ? "Copied" : "Copy note"}
              </button>
            )}
          </figcaption>
          <blockquote>{idea.pitch}</blockquote>
        </figure>
      )}

      {status.kind === "blocked" && (
        <p className={`${s.fine} ${s.ideaState}`}>
          {list(status.ids)} {status.ids.length === 1 ? "is" : "are"} in another trade right now, so ESPN won&apos;t take this offer yet.
        </p>
      )}
      {status.kind === "offered" && <p className={`${s.fine} ${s.ideaState}`}>Offered on ESPN. It&apos;s in Pending.</p>}

      {verdict &&
        (!active || canOffer) &&
        (offering ? (
          <TradeWrite
            leagueId={leagueId}
            agreed={agreed}
            body={{
              kind: "propose",
              week: view.currentWeek,
              snapshot: snapshotOf(view.teams.find((t) => t.id === view.myTeamId)?.roster ?? []),
              partner: idea.partner,
              gives: idea.gives,
              gets: idea.gets,
              drops: verdict.a.drops,
            }}
            question={
              <>
                Offer {partner} this trade on ESPN? You send <b>{list(idea.gives)}</b> and get <b>{list(idea.gets)}</b>
                {verdict.a.drops.length > 0 && (
                  <>
                    , and drop <b>{list(verdict.a.drops)}</b> to make room if they accept
                  </>
                )}
                .
              </>
            }
            confirm="Offer on ESPN"
            sending="Sending the offer…"
            onCancel={() => setOffering(false)}
            onDone={(landed) => {
              setOffering(false);
              onNotice(landed ? `Offer sent to ${partner}. It's in Pending on ESPN.` : "ESPN doesn't show your offer. Check ESPN. War Room has been alerted.");
            }}
          />
        ) : (
          <div className={`${s.offerActions} ${s.ideaActions}`}>
            {!active && (
              <button type="button" className={`${s.button} ${s.buttonGhost}`} onClick={() => onLoad(trade, ideaId(idea.kind))}>
                Load into builder
              </button>
            )}
            {canOffer && (
              <button type="button" className={s.button} onClick={() => setOffering(true)} disabled={status.kind === "blocked"}>
                Offer on ESPN
              </button>
            )}
          </div>
        ))}
    </li>
  );
}
