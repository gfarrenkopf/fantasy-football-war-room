"use client";

import { useState } from "react";
import type { SeasonAiState } from "@/lib/ai/season/state";
import { tradeEmphasis } from "@/lib/season/emphasis";
import { snapshotOf } from "@/lib/season/apply";
import { evaluateTrade, tradeFromPending, type Trade, type TradeVerdict } from "@/lib/season/trade";
import type { PendingTrade } from "@/lib/season/types";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { AiTradeWriteupCard } from "./AiPanel";
import { Check } from "./Icons";
import { LocalTime, WEEKDAY_DATE_TIME } from "./LocalTime";
import { PlayerLine, recordText, signed } from "./parts";
import s from "./season.module.css";
import { TradeGain, teamName, tradeHeadline } from "./TradeGain";
import { TradeIdeas } from "./TradeIdeas";
import { TradeWrite } from "./TradeWrite";

const SLOT_LABEL: Record<string, string> = { SUPERFLEX: "OP", DST: "D/ST" };

const byRos = (a: ViewPlayer, b: ViewPlayer) => b.ros - a.ros;

/**
 * Trades (10.6, 10.9): the user's offers pending on ESPN, each graded, and a builder for a what-if
 * or a counter. Every verdict compares both starting lineups for the rest of the season; nothing
 * here is sent to ESPN.
 */
export function TradePanel({ view, leagueId, ai, writeConsented }: { view: SeasonView; leagueId: string; ai: SeasonAiState | null; writeConsented: boolean }) {
  const others = view.teams.filter((t) => t.id !== view.myTeamId);
  const [partnerId, setPartnerId] = useState(others[0]?.id ?? 0);
  const [gives, setGives] = useState<number[]>([]);
  const [gets, setGets] = useState<number[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [side, setSide] = useState<"send" | "get">("send");
  const [proposing, setProposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  const partner = others.find((t) => t.id === partnerId);

  if (!mine || !partner) return <p className={`${s.panel} ${s.note}`}>There&apos;s no one in this league to trade with.</p>;

  // The React Compiler memoizes this; it's a few milliseconds even for a 16-team league.
  const trade: Trade = { teamA: view.myTeamId, gives, teamB: partner.id, gets };
  const verdict = evaluateTrade(view.teams, view, trade);
  const tradeId = `${partner.id}:${[...gives].sort().join(",")}:${[...gets].sort().join(",")}`;
  const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  const list = (ids: readonly number[]) => ids.map((id) => names.get(id) ?? `ESPN player ${id}`).join(", ");
  const toggle = (list: number[], set: (next: number[]) => void, id: number) => {
    setLoaded(null);
    setProposing(false);
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };
  /** Opens a trade in the builder: an offer pending on ESPN (by its id) or a trade idea. */
  const load = (trade: Trade, id: string) => {
    setProposing(false);
    setPartnerId(trade.teamB);
    setGives([...trade.gives]);
    setGets([...trade.gets]);
    setLoaded(id);
    document.getElementById("builder-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const clear = () => {
    setProposing(false);
    setGives([]);
    setGets([]);
    setLoaded(null);
  };

  return (
    <div className={s.trades}>
      {view.tradeDeadlinePassed && view.tradeDeadline && (
        <p className={`${s.panel} ${s.note} ${s.deadlinePassed}`} role="status">
          The trade deadline passed <LocalTime iso={view.tradeDeadline} format={WEEKDAY_DATE_TIME} />. Trades here are what-ifs now: ESPN won&apos;t process new
          ones this season.
        </p>
      )}
      <div className={s.tradeSide}>
        {ai && <TradeIdeas view={view} leagueId={leagueId} ai={ai} writeConsented={writeConsented} loadedId={loaded} onLoad={load} onNotice={setNotice} />}
        <section className={s.column} aria-labelledby="pending-title">
          <div className={s.columnHead}>
            <h2 id="pending-title" className={s.columnTitle}>
              Pending on ESPN
            </h2>
            <span className={s.panelNote}>Answer here or on ESPN</span>
          </div>
          {notice && (
            <p className={s.fine} role="status">
              {notice}
            </p>
          )}
          {view.tradeDeadline && !view.tradeDeadlinePassed && (
            <p className={s.fine}>
              Trade deadline <b>
                <LocalTime iso={view.tradeDeadline} format={WEEKDAY_DATE_TIME} />
              </b>
            </p>
          )}
          {view.pendingTrades.length ? (
            <ul className={s.pending}>
              {view.pendingTrades.map((pending) => (
                <Offer
                  key={pending.id}
                  view={view}
                  leagueId={leagueId}
                  agreed={writeConsented}
                  pending={pending}
                  names={names}
                  active={loaded === pending.id}
                  onOpen={(pending, trade) => load(trade, pending.id)}
                  onNotice={setNotice}
                />
              ))}
            </ul>
          ) : (
            <p className={`${s.panel} ${s.note} ${s.fine}`}>No trade offers waiting on ESPN. Build one to see how it would land for both teams.</p>
          )}
        </section>
      </div>

      <section className={s.column} aria-labelledby="builder-title">
        <div className={s.columnHead}>
          <h2 id="builder-title" className={s.columnTitle}>
            {loaded?.startsWith("idea:") ? "Tweak this idea" : loaded ? "Tweak it into a counter" : "Check a trade"}
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
          {mine.standing && partner.standing && (
            <p className={`${s.fine} ${s.standings}`}>
              You <b>{recordText(mine.standing, view.teams.length)}</b> · {partner.name} <b>{recordText(partner.standing, view.teams.length)}</b>
            </p>
          )}

          <div className={s.verdict}>
            {verdict ? (
              <>
                <TradeGain verdict={verdict} partner={partner.name} compact />
                <SlotChanges verdict={verdict} partner={partner.name} names={names} />
              </>
            ) : (
              <p className={`${s.fine} ${s.panel} ${s.note}`}>Pick who you&apos;d send and who you&apos;d get. The verdict compares both starting lineups for the rest of the season.</p>
            )}
          </div>

          {/* What to do with it scrolls with the page: only the verdict above stays pinned. */}
          {verdict && (
            <div className={s.verdictActions}>
              {!view.tradeDeadlinePassed &&
                (proposing ? (
                  <TradeWrite
                    leagueId={leagueId}
                    agreed={writeConsented}
                    body={{ kind: "propose", week: view.currentWeek, snapshot: snapshotOf(mine.roster), partner: partner.id, gives, gets, drops: verdict.a.drops }}
                    question={
                      <>
                        Offer {partner.name} this trade on ESPN? You send <b>{list(gives) || "nothing"}</b> and get <b>{list(gets) || "nothing"}</b>
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
                    onCancel={() => setProposing(false)}
                    onDone={(landed) => {
                      setProposing(false);
                      setNotice(landed ? `Offer sent to ${partner.name}. It's in Pending on ESPN.` : "ESPN doesn't show your offer. Check ESPN. Draft Room has been alerted.");
                      clear();
                    }}
                  />
                ) : (
                  <button type="button" className={s.button} onClick={() => setProposing(true)}>
                    Offer this on ESPN
                  </button>
                ))}
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
            </div>
          )}

          {/* On a phone: pinned while the user ticks players, so the verdict and the switch stay in reach. */}
          <div className={s.pickBar}>
            <PickBarVerdict verdict={verdict} />
            <div className={`${s.segment} ${s.pickerToggle}`} role="tablist" aria-label="Which roster">
              <button type="button" role="tab" className={s.tab} aria-selected={side === "send"} onClick={() => setSide("send")}>
                You send {gives.length > 0 && <span className={s.badge}>{gives.length}</span>}
              </button>
              <button type="button" role="tab" className={s.tab} aria-selected={side === "get"} onClick={() => setSide("get")}>
                You get {gets.length > 0 && <span className={s.badge}>{gets.length}</span>}
              </button>
            </div>
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
  leagueId,
  agreed,
  pending,
  names,
  active,
  onOpen,
  onNotice,
}: {
  view: SeasonView;
  leagueId: string;
  agreed: boolean;
  pending: PendingTrade;
  names: Map<number, string>;
  active: boolean;
  onOpen: (pending: PendingTrade, trade: Trade) => void;
  onNotice: (message: string) => void;
}) {
  const [acting, setActing] = useState<"accept" | "decline" | "withdraw" | null>(null);
  const trade = tradeFromPending(pending, view.myTeamId);
  if (!trade) return null;
  const partner = teamName(view, trade.teamB);
  const verdict = evaluateTrade(view.teams, view, trade);
  const [kind, label] =
    pending.status === "accepted" ? ["accepted", "Accepted"] : pending.proposerTeamId === view.myTeamId ? ["mine", "Your offer"] : ["theirs", "Offer"];
  const [timeLabel, timeAt] = pending.status === "accepted" ? ["Goes through", pending.processesAt] : ["Expires", pending.expiresAt];
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
        {timeAt && (
          <span className={s.offerWhen}>
            {timeLabel} <LocalTime iso={timeAt} />
          </span>
        )}
      </div>
      <dl className={s.sides}>
        <dt>You get</dt>
        <dd>{list(trade.gets) || "Nothing"}</dd>
        <dt>You send</dt>
        <dd>{list(trade.gives) || "Nothing"}</dd>
      </dl>
      {verdict && active ? (
        // Open in the builder, which grades it; a second verdict here would only repeat it.
        <p className={`${s.offerOpen} ${s.fine}`}>
          {pending.status === "accepted" ? "Graded in the builder." : "Graded in the builder. Change either side to make it a counter."}
        </p>
      ) : verdict ? (
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
      {pending.status === "proposed" &&
        (acting ? (
          <TradeWrite
            leagueId={leagueId}
            agreed={agreed}
            body={{ kind: acting, week: view.currentWeek, tradeId: pending.id, ...(acting === "accept" ? { snapshot: snapshotOf(view.teams.find((t) => t.id === view.myTeamId)?.roster ?? []) } : {}) }}
            question={
              acting === "accept" ? (
                <>
                  Accept on ESPN? You get <b>{list(trade.gets) || "nothing"}</b> and send <b>{list(trade.gives) || "nothing"}</b>. It goes through after the league&apos;s review.
                </>
              ) : acting === "decline" ? (
                <>Decline {partner}&apos;s offer on ESPN?</>
              ) : (
                <>Withdraw your offer to {partner} on ESPN?</>
              )
            }
            confirm={acting === "accept" ? "Accept on ESPN" : acting === "decline" ? "Decline on ESPN" : "Withdraw on ESPN"}
            sending={acting === "accept" ? "Accepting…" : acting === "decline" ? "Declining…" : "Withdrawing…"}
            onCancel={() => setActing(null)}
            onDone={(landed) => {
              const past = acting === "accept" ? "accepted. It's in the league's review" : acting === "decline" ? "declined" : "withdrawn";
              onNotice(landed ? `Offer ${past}.` : "ESPN doesn't show that change. Check ESPN. Draft Room has been alerted.");
              setActing(null);
            }}
          />
        ) : (
          <div className={s.offerActions}>
            {kind === "mine" ? (
              <button type="button" className={`${s.button} ${s.buttonGhost}`} onClick={() => setActing("withdraw")}>
                Withdraw
              </button>
            ) : (
              <>
                {!view.tradeDeadlinePassed && (
                  <button type="button" className={s.button} onClick={() => setActing("accept")}>
                    Accept
                  </button>
                )}
                <button type="button" className={`${s.button} ${s.buttonGhost}`} onClick={() => setActing("decline")}>
                  Decline
                </button>
              </>
            )}
          </div>
        ))}
    </li>
  );
}

/** The verdict in one line, for the phone's pinned bar. The full verdict above already announces it. */
function PickBarVerdict({ verdict }: { verdict: TradeVerdict | null }) {
  if (!verdict) {
    return (
      <p className={s.pickBarVerdict} aria-hidden>
        <span className={s.pickBarHeadline}>Pick players to trade</span>
      </p>
    );
  }
  const you = verdict.a.perWeek;
  const level = tradeEmphasis(you);
  return (
    <p className={s.pickBarVerdict} data-level={level} data-sign={you < 0 ? "loss" : "gain"} aria-hidden>
      {level === "rest" ? (
        <Check className={s.pickBarNumber} />
      ) : (
        <span className={s.pickBarNumber}>
          <span className="tabular-nums">{signed(you)}</span> <span className={s.gainUnit}>a week</span>
        </span>
      )}
      <span className={s.pickBarHeadline}>{tradeHeadline(verdict)}</span>
    </p>
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
    <fieldset className={s.rosterPicker} data-hidden={hidden}>
      <legend className="sr-only">{title}</legend>
      <div className={s.rosterPickerHead} aria-hidden>
        {title}
        <span>Rest of season</span>
      </div>
      <ul className={s.rosterPickerList}>
        {/* Picked players first, so a trade loaded from ESPN shows who's in it without scrolling. */}
        {[...roster].sort((a, b) => Number(picked.includes(b.playerId)) - Number(picked.includes(a.playerId)) || byRos(a, b)).map((p) => {
          const on = picked.includes(p.playerId);
          return (
            <li key={p.playerId}>
              <label className={s.pick} data-picked={on}>
                <input type="checkbox" checked={on} onChange={() => onToggle(p.playerId)} />
                <PlayerLine player={p} value="none" ownership />
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
