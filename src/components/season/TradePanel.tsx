"use client";

import { useState } from "react";
import type { SeasonAiState } from "@/lib/ai/season/state";
import { tradeEmphasis, type Emphasis } from "@/lib/season/emphasis";
import { evaluateTrade, tradeFromPending, type Trade, type TradeVerdict } from "@/lib/season/trade";
import type { PendingTrade } from "@/lib/season/types";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { AiTradeWriteupCard } from "./AiPanel";
import { Gain, PlayerLine, signed } from "./parts";
import s from "./season.module.css";

const SLOT_LABEL: Record<string, string> = { SUPERFLEX: "OP", DST: "D/ST" };

const GOOD: Record<Emphasis, string> = {
  rest: "About even for you",
  trim: "Slightly better for you",
  gain: "Better for you",
  swing: "A strong trade for you",
  must: "A steal for you",
};
const BAD: Record<Emphasis, string> = {
  rest: "About even for you",
  trim: "Slightly worse for you",
  gain: "Costs you",
  swing: "Costs you a lot",
  must: "Lopsided against you",
};

const byRos = (a: ViewPlayer, b: ViewPlayer) => b.ros - a.ros;
const teamName = (view: SeasonView, id: number) => view.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : null);

/** The verdict for the user, told on the same scale as the lineup's gain. */
function TradeGain({ verdict, partner, compact, inline }: { verdict: TradeVerdict; partner: string; compact?: boolean; inline?: boolean }) {
  const you = verdict.a.perWeek;
  const them = verdict.b.perWeek;
  const level = tradeEmphasis(you);
  const headline = you >= 0 ? GOOD[level] : BAD[level];
  return (
    <Gain
      compact={compact}
      inline={inline}
      level={level}
      value={you}
      unit="a week"
      headline={level !== "rest" && you > 0 && them > 0.05 ? `${headline}, and for them` : headline}
      detail={
        <>
          {partner} <span className="tabular-nums">{signed(them)}</span> a week · you <span className="tabular-nums">{signed(verdict.a.delta)}</span> over the{" "}
          {verdict.weeks} weeks left
        </>
      }
    />
  );
}

/**
 * Trades (10.6, 10.9): the user's offers pending on ESPN, each graded, and a builder for a what-if
 * or a counter. Every verdict compares both starting lineups for the rest of the season; nothing
 * here is sent to ESPN.
 */
export function TradePanel({ view, leagueId, ai }: { view: SeasonView; leagueId: string; ai: SeasonAiState | null }) {
  const others = view.teams.filter((t) => t.id !== view.myTeamId);
  const [partnerId, setPartnerId] = useState(others[0]?.id ?? 0);
  const [gives, setGives] = useState<number[]>([]);
  const [gets, setGets] = useState<number[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [side, setSide] = useState<"send" | "get">("send");
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  const partner = others.find((t) => t.id === partnerId);

  if (!mine || !partner) return <p className={`${s.panel} ${s.note}`}>There&apos;s no one in this league to trade with.</p>;

  // The React Compiler memoizes this; it's a few milliseconds even for a 16-team league.
  const trade: Trade = { teamA: view.myTeamId, gives, teamB: partner.id, gets };
  const verdict = evaluateTrade(view.teams, view, trade);
  const tradeId = `${partner.id}:${[...gives].sort().join(",")}:${[...gets].sort().join(",")}`;
  const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  const toggle = (list: number[], set: (next: number[]) => void, id: number) => {
    setLoaded(null);
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };
  const open = (pending: PendingTrade, trade: Trade) => {
    setPartnerId(trade.teamB);
    setGives([...trade.gives]);
    setGets([...trade.gets]);
    setLoaded(pending.id);
    document.getElementById("builder-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const clear = () => {
    setGives([]);
    setGets([]);
    setLoaded(null);
  };

  return (
    <div className={s.trades}>
      <section className={s.column} aria-labelledby="pending-title">
        <div className={s.columnHead}>
          <h2 id="pending-title" className={s.columnTitle}>
            Pending on ESPN
          </h2>
          <span className={s.panelNote}>Accept or decline on ESPN</span>
        </div>
        {view.pendingTrades.length ? (
          <ul className={s.pending}>
            {view.pendingTrades.map((pending) => (
              <Offer key={pending.id} view={view} pending={pending} names={names} active={loaded === pending.id} onOpen={open} />
            ))}
          </ul>
        ) : (
          <p className={`${s.panel} ${s.note} ${s.fine}`}>No trade offers waiting on ESPN. Build one to see how it would land for both teams.</p>
        )}
      </section>

      <section className={s.column} aria-labelledby="builder-title">
        <div className={s.columnHead}>
          <h2 id="builder-title" className={s.columnTitle}>
            {loaded ? "Tweak it into a counter" : "Check a trade"}
          </h2>
          {(gives.length > 0 || gets.length > 0) && (
            <button type="button" className={`${s.button} ${s.buttonGhost}`} onClick={clear}>
              Clear
            </button>
          )}
        </div>
        <div className={s.builder}>
          <div className={s.builderTop}>
            <label className={s.field}>
              Trade with
              <select
                className={s.select}
                value={partner.id}
                onChange={(e) => {
                  setPartnerId(Number(e.target.value));
                  setGets([]);
                  setLoaded(null);
                }}
              >
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={s.verdictSticky}>
            {verdict ? (
              <>
                <TradeGain verdict={verdict} partner={partner.name} compact />
                <SlotChanges verdict={verdict} partner={partner.name} names={names} />
                {ai && (
                  <AiTradeWriteupCard
                    key={tradeId}
                    leagueId={leagueId}
                    view={view}
                    ai={ai}
                    trade={trade}
                    onCounter={(counter) => {
                      setGives([...counter.gives]);
                      setGets([...counter.gets]);
                      setLoaded(null);
                    }}
                  />
                )}
              </>
            ) : (
              <p className={`${s.fine} ${s.panel} ${s.note}`}>Pick who you&apos;d send and who you&apos;d get. The verdict compares both starting lineups for the rest of the season.</p>
            )}
          </div>

          <div className={`${s.segment} ${s.pickerToggle}`} role="tablist" aria-label="Which roster">
            <button type="button" role="tab" className={s.tab} aria-selected={side === "send"} onClick={() => setSide("send")}>
              You send {gives.length > 0 && <span className={s.badge}>{gives.length}</span>}
            </button>
            <button type="button" role="tab" className={s.tab} aria-selected={side === "get"} onClick={() => setSide("get")}>
              You get {gets.length > 0 && <span className={s.badge}>{gets.length}</span>}
            </button>
          </div>

          <div className={s.pickers}>
            <RosterPicker title="You send" roster={mine.roster} picked={gives} hidden={side !== "send"} onToggle={(id) => toggle(gives, setGives, id)} />
            <RosterPicker title={`You get from ${partner.name}`} roster={partner.roster} picked={gets} hidden={side !== "get"} onToggle={(id) => toggle(gets, setGets, id)} />
          </div>
        </div>
      </section>
    </div>
  );
}

function Offer({
  view,
  pending,
  names,
  active,
  onOpen,
}: {
  view: SeasonView;
  pending: PendingTrade;
  names: Map<number, string>;
  active: boolean;
  onOpen: (pending: PendingTrade, trade: Trade) => void;
}) {
  const trade = tradeFromPending(pending, view.myTeamId);
  if (!trade) return null;
  const partner = teamName(view, trade.teamB);
  const verdict = evaluateTrade(view.teams, view, trade);
  const [kind, label] =
    pending.status === "accepted" ? ["accepted", "Accepted"] : pending.proposerTeamId === view.myTeamId ? ["mine", "Your offer"] : ["theirs", "Offer"];
  const time = pending.status === "accepted" ? pending.processesAt && `Goes through ${when(pending.processesAt)}` : pending.expiresAt && `Expires ${when(pending.expiresAt)}`;
  const list = (ids: readonly number[]) => ids.map((id) => names.get(id) ?? `ESPN player ${id}`).join(", ");
  return (
    <li className={s.offer} data-active={active}>
      <div className={s.offerHead}>
        <h3 className={s.offerTitle}>
          <span className={s.offerKind} data-kind={kind}>
            {label}
          </span>
          {partner}
        </h3>
        {time && (
          <span className={s.offerWhen} suppressHydrationWarning>
            {time}
          </span>
        )}
      </div>
      <dl className={s.sides}>
        <dt>You get</dt>
        <dd>{list(trade.gets) || "Nothing"}</dd>
        <dt>You send</dt>
        <dd>{list(trade.gives) || "Nothing"}</dd>
      </dl>
      {verdict ? (
        <>
          <TradeGain verdict={verdict} partner={partner} compact inline />
          <div className={s.offerFoot}>
            <span className={s.fine}>{pending.status === "accepted" ? "Already agreed; it goes through unless the league stops it." : ""}</span>
            <button type="button" className={s.button} onClick={() => onOpen(pending, trade)}>
              {pending.status === "accepted" ? "Look closer" : "Tweak as a counter"}
            </button>
          </div>
        </>
      ) : (
        <p className={s.fine}>Can&apos;t grade this one: a player in it is no longer on those rosters.</p>
      )}
    </li>
  );
}

/** Where the lineup moves, slot by slot, and who'd have to be cut to make room. */
function SlotChanges({ verdict, partner, names }: { verdict: TradeVerdict; partner: string; names: Map<number, string> }) {
  const moved = verdict.a.bySlot.filter((slot) => Math.abs(slot.after - slot.before) >= 0.05);
  const drops = [...verdict.a.drops.map((id) => `You'd drop ${names.get(id)} to make room`), ...verdict.b.drops.map((id) => `${partner} would drop ${names.get(id)}`)];
  if (!moved.length && !drops.length) return null;
  return (
    <ul className={s.slotChanges}>
      {moved.map((slot) => {
        const d = slot.after - slot.before;
        return (
          <li key={slot.key}>
            {SLOT_LABEL[slot.key] ?? slot.key} <span className={`${d >= 0 ? s.up : s.down} tabular-nums`}>{signed(d)}</span>
          </li>
        );
      })}
      {drops.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function RosterPicker({
  title,
  roster,
  picked,
  hidden,
  onToggle,
}: {
  title: string;
  roster: ViewPlayer[];
  picked: number[];
  hidden: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <fieldset className={s.picker} data-hidden={hidden}>
      <legend className="sr-only">{title}</legend>
      <div className={s.pickerHead} aria-hidden>
        {title}
        <span>Rest of season</span>
      </div>
      <ul className={s.pickerList}>
        {/* Picked players first, so a trade loaded from ESPN shows who's in it without scrolling. */}
        {[...roster].sort((a, b) => Number(picked.includes(b.playerId)) - Number(picked.includes(a.playerId)) || byRos(a, b)).map((p) => {
          const on = picked.includes(p.playerId);
          return (
            <li key={p.playerId}>
              <label className={s.pick} data-picked={on}>
                <input type="checkbox" checked={on} onChange={() => onToggle(p.playerId)} />
                <PlayerLine player={p} value="none" />
                <span className={`${s.ros} tabular-nums`}>
                  <b>{p.ros.toFixed(0)}</b>pts
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
