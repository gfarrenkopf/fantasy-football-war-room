"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import type { SeasonAiState } from "@/lib/ai/season/state";
import { canPlay } from "@/lib/season/apply";
import { lineupEmphasis, type Emphasis } from "@/lib/season/emphasis";
import { compareLineups, isRuledOut } from "@/lib/season/lineup";
import type { LineupSlot } from "@/lib/season/types";
import type { SeasonView, ViewPlayer, WarRoomMove } from "@/lib/season/view";
import { AiLineupCard } from "./AiPanel";
import { ApplyLineup, IrPicker } from "./ApplyLineup";
import { ArrowRight, Check, External } from "./Icons";
import { Gain, hasStarted, INJURY_TAG, PlayerLine, pts, signed, SLOT_LABEL } from "./parts";
import s from "./season.module.css";
import { useLineupDraft, type LineupDraft } from "./useLineupDraft";

const HEADLINE: Record<Emphasis, string> = {
  rest: "Your lineup is set",
  trim: "A small tweak",
  gain: "Worth a swap",
  swing: "Big swing on your bench",
  must: "Points stuck on your bench",
};

/** Why a starter is coming out, when it's news, in the word managers use: BYE, or his designation (OUT, IR, SSPD). */
function outTag(p: ViewPlayer): string | null {
  if (isRuledOut(p.injuryStatus)) return INJURY_TAG[p.injuryStatus] ?? "OUT";
  if (p.points === 0 && p.projected) return "BYE";
  return null;
}

/** Where a player is on ESPN, as the end of "up from …": "the bench", "WR". */
const fromWhere = (p: ViewPlayer) => (p.slot === "BN" ? "the bench" : SLOT_LABEL[p.slot]);

/**
 * This week's lineup (10.5, 10.8, 12.1, APE-249), laid out the way ESPN's roster screen is: starters
 * then bench, one row per player with his slot, his facts and his points. Rows show ESPN's lineup;
 * a change War Room suggests, or one the user makes by tapping a slot, shows as a swap on that row,
 * ticked to be made. The panel beside them applies the ticked changes.
 */
export function LineupPanel({ view, leagueId, ai, writeConsented }: { view: SeasonView; leagueId: string; ai: SeasonAiState | null; writeConsented: boolean }) {
  const draft = useLineupDraft(view);
  const panelInView = useInView("apply-panel");
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  if (!mine) return <p className={`${s.panel} ${s.note}`}>ESPN didn&apos;t list your team in this league.</p>;

  const { lineup } = view;
  const suggested = lineup.moves.length > 0;
  // War Room's changes, seat by seat: the hero names them, whatever the user has staged since.
  const byId = draft.byId;
  const suggestions = compareLineups(mine.roster, lineup)
    .filter((r) => r.changed)
    .map((r) => {
      const into = r.next === null ? undefined : byId.get(r.next);
      const out = r.now === null ? undefined : byId.get(r.now);
      return { key: `${r.key}-${r.next}`, slot: SLOT_LABEL[r.key], into, out, gain: (into?.points ?? 0) - (out?.points ?? 0), tag: out ? outTag(out) : null };
    });
  const gain = lineup.total - lineup.currentTotal;
  const level = suggested ? lineupEmphasis(gain) : "rest";
  const swaps = draft.seats.filter((_, i) => draft.onEspn[i] !== draft.staged[i]).length;
  const bench = draft.roster.filter((p) => p.slot === "BN").sort((a, b) => b.points - a.points);
  const ir = draft.roster.filter((p) => p.slot === "IR");
  const espnTeam = `https://fantasy.espn.com/football/team?leagueId=${view.espnLeagueId}&seasonId=${view.season}&teamId=${view.myTeamId}`;
  const reviewable = draft.chosen.length > 0 && draft.problems.length === 0 && draft.phase.kind === "idle" && !panelInView;

  return (
    <div className={s.lineup}>
      <div className={s.stack}>
        <Gain
          className={s.orderGain}
          level={level}
          value={gain}
          unit="pts"
          headline={HEADLINE[level]}
          aside={
            suggested && (
              <p className={s.gainShift}>
                <span className={s.gainShiftFrom}>
                  <span className="tabular-nums">{pts(lineup.currentTotal)}</span> →
                </span>{" "}
                <b className="tabular-nums">{pts(lineup.total)}</b>
                <span className={s.gainShiftNote}>projected · week {view.currentWeek}</span>
              </p>
            )
          }
          detail={
            suggested ? (
              <ul className={s.gainMoves}>
                {suggestions.map((m) => (
                  <li key={m.key}>
                    <span className={s.gainMoveText}>
                      {m.into ? (
                        <>
                          Start <b>{m.into.name}</b>
                        </>
                      ) : (
                        <>Leave {m.slot} empty</>
                      )}
                      {m.out && (
                        <>
                          {" "}
                          over {m.out.name}
                          {m.tag && (
                            <>
                              {" "}
                              <span className={s.tag} data-kind="out">
                                {m.tag}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </span>
                    <b className={`${s.gainMoveGain} tabular-nums`}>{signed(m.gain)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <b className="tabular-nums">{pts(lineup.total)}</b> projected points in week {view.currentWeek}. Check back before kickoff: injury news can
                change it.
              </>
            )
          }
        />

        <section className={`${s.panel} ${s.orderTable}`} aria-labelledby="starters-title">
          <div className={s.panelHead}>
            <h2 id="starters-title" className={s.panelTitle}>
              Starters
            </h2>
            <span className={s.panelNote}>
              {swaps ? (swaps === 1 ? "1 swap · " : `${swaps} swaps · `) : ""}On ESPN <span className="tabular-nums">{pts(lineup.currentTotal)}</span>
            </span>
            <LineupMenu draft={draft} irSlots={view.irSlots} />
          </div>
          <ul className={s.rows}>
            {draft.seats.map((key, i) => (
              <StarterRow key={`${key}-${i}`} draft={draft} seat={i} made={view.warRoomMoves} />
            ))}
          </ul>
        </section>

        <section className={`${s.panel} ${s.orderBench}`} aria-labelledby="bench-title">
          <div className={s.panelHead}>
            <h2 id="bench-title" className={s.panelTitle}>
              Bench
            </h2>
            <span className={s.panelNote}>{bench.length === 1 ? "1 player" : `${bench.length} players`}</span>
          </div>
          <ul className={s.rows}>
            {bench.map((p) => (
              <BenchRow key={p.playerId} draft={draft} player={p} />
            ))}
            {ir.map((p) => (
              <li key={p.playerId} className={s.row}>
                <span className={s.rowSlot}>
                  <span className={s.slotPill} data-static>
                    IR
                  </span>
                </span>
                <PlayerLine player={p} value="none" news ownership live stacked />
                <Points player={p} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className={s.stack}>
        <section id="apply-panel" className={`${s.panel} ${s.orderMoves}`} aria-labelledby="moves-title">
          <div className={s.panelHead}>
            <h2 id="moves-title" className={s.panelTitle}>
              {draft.moves.length ? "Make these moves on ESPN" : "Nothing to change on ESPN"}
            </h2>
          </div>
          <ApplyLineup draft={draft} view={view} leagueId={leagueId} agreed={writeConsented} />
          <a className={s.applyEspn} href={espnTeam} target="_blank" rel="noreferrer">
            Open my team on ESPN <External />
          </a>
        </section>

        {view.matchup && <MatchupCard view={view} />}

        {ai && <AiLineupCard leagueId={leagueId} view={view} ai={ai} className={s.orderAi} />}
      </div>

      {/* On a phone the apply panel sits below the rows, so the button to review follows the thumb. */}
      {reviewable && (
        <button
          type="button"
          className={s.reviewBar}
          onClick={() => {
            draft.setPhase({ kind: "review" });
            document.getElementById("apply-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          Review {draft.picked.length === 1 ? "1 change" : `${draft.picked.length} changes`}
        </button>
      )}
    </div>
  );
}

/** Whether the element with this id is on screen: the review bar steps aside once the panel it leads to is. */
function useInView(id: string): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);
  return seen;
}

/** A player's points, large on the right: his projection before kickoff, what he's scored after it. */
function Points({ player, delta }: { player: ViewPlayer; delta?: number }) {
  const started = hasStarted(player);
  return (
    <span className={s.rowPoints}>
      {started ? (
        <span className={`${s.rowPts} ${s.actual} tabular-nums`}>
          {pts(player.actual ?? 0)}
          <span className="sr-only"> points so far</span>
        </span>
      ) : (
        <span className={`${s.rowPts} tabular-nums`}>
          {pts(player.points)}
          <span className="sr-only"> projected</span>
        </span>
      )}
      {delta !== undefined ? (
        <span className={`${s.rowDelta} tabular-nums`} data-loss={delta < 0 || undefined}>
          {signed(delta)}
          <span className="sr-only"> projected</span>
        </span>
      ) : (
        started && (
          <span className={s.rowSub}>
            proj <span className="tabular-nums">{pts(player.points)}</span>
          </span>
        )
      )}
    </span>
  );
}

/**
 * One starting seat: ESPN's player on the left, as set; a change on offer on the right, ticked to be
 * made, showing who comes in and what he adds. A player
 * War Room got into this seat this week is marked with a tint and a bar (APE-256); what the move was
 * worth opens from the bar and his points, and is read out to screen readers.
 */
function StarterRow({ draft, seat, made }: { draft: LineupDraft; seat: number; made: readonly WarRoomMove[] }) {
  const key = draft.seats[seat];
  const now = draft.onEspn[seat] === null ? undefined : draft.byId.get(draft.onEspn[seat]!);
  const next = draft.staged[seat] === null ? undefined : draft.byId.get(draft.staged[seat]!);
  const changed = now?.playerId !== next?.playerId;
  const group = changed ? draft.changeOf.get(next?.playerId ?? now?.playerId ?? -1) : undefined;
  const picked = group ? draft.isPicked(group) : true;
  // His injury tag already shows by his name; a bye has no tag of its own, so it gets one here.
  const bye = changed && now ? outTag(now) === "BYE" : false;
  const ours = !changed && now ? made.find((m) => m.playerId === now.playerId && m.slot === key) : undefined;
  const delta = (next?.points ?? 0) - (now?.points ?? 0);
  return (
    <li className={s.row} data-changed={changed} data-skipped={changed && !picked} data-made={!!ours || undefined}>
      <span className={s.rowSlot}>
        <SeatPicker draft={draft} seat={seat} label={SLOT_LABEL[key]} />
      </span>
      {/* Left: the player ESPN has in this seat, as set. */}
      <span className={s.rowPlayer}>
        {now ? <PlayerLine player={now} locked={now.locked} value="none" news ownership live stacked /> : <span className={s.fine}>Empty on ESPN</span>}
        {bye && (
          <span className={s.rowMove}>
            <span className={s.tag} data-kind="out">
              BYE
            </span>
          </span>
        )}
      </span>
      {ours && now ? <MadeNote move={ours} player={now} made={made} /> : now ? <Points player={now} /> : <span />}
      {/* Right: the change on offer, ticked to be made; the whole box is the tick. */}
      {changed && (
        <label className={s.suggest}>
          {group && (
            <input type="checkbox" className={s.suggestCheck} checked={picked} disabled={draft.phase.kind === "sending"} onChange={(e) => draft.toggle(group, e.target.checked)} />
          )}
          <span className={s.suggestBody}>
            <span className={s.suggestHead}>
              <ArrowRight className={s.suggestArrow} />
              <span className="sr-only">Swap in </span>
              <b className={s.suggestName}>{next ? next.name : "Leave empty"}</b>
            </span>
            {next && (
              <span className={s.suggestFacts}>
                <span className={s.pos} data-pos={next.pos}>
                  {next.pos === "DST" ? "D/ST" : next.pos}
                </span>{" "}
                · {next.team ?? "FA"} · from {fromWhere(next)}
              </span>
            )}
          </span>
          <span className={s.suggestPts}>
            {next && <span className={`${s.rowPts} tabular-nums`}>{pts(next.points)}</span>}
            <span className={`${s.rowDelta} tabular-nums`} data-loss={delta < 0 || undefined}>
              {signed(delta)}
              <span className="sr-only"> projected</span>
            </span>
          </span>
        </label>
      )}
    </li>
  );
}

/** Opens or closes a note. A tap only opens it, so a hover that already did isn't undone; tapping elsewhere closes it. */
function show(id: string, on: boolean) {
  const note = document.getElementById(id);
  if (!note) return;
  if (on && !note.matches(":popover-open")) note.showPopover();
  if (!on && note.matches(":popover-open")) note.hidePopover();
}

/** Where a pointer can hover, hovering opens the note too. */
function hover(id: string, on: boolean) {
  if (window.matchMedia("(hover: hover)").matches) show(id, on);
}

/**
 * A War Room move's points, as a button over the row's bar and points: it opens what the move gained
 * and what War Room's moves gained this week. The screen shows only the mark; the words wait for a tap.
 */
function MadeNote({ move, player, made }: { move: WarRoomMove; player: ViewPlayer; made: readonly WarRoomMove[] }) {
  const id = useId();
  const week = made.reduce((sum, m) => sum + m.gain, 0);
  const line = `Started by War Room · ${signed(move.gain)} proj`;
  const anchor = `--made${id.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <>
      <button
        type="button"
        className={s.madeButton}
        aria-label={`${pts(hasStarted(player) ? (player.actual ?? 0) : player.points)}. ${line}`}
        onClick={() => show(id, true)}
        onMouseEnter={() => hover(id, true)}
        onMouseLeave={() => hover(id, false)}
        style={{ anchorName: anchor } as CSSProperties}
      >
        <span className={s.madeBar} aria-hidden />
        <Points player={player} />
      </button>
      <div id={id} popover="auto" className={`${s.picker} ${s.madeNote}`} style={{ positionAnchor: anchor } as CSSProperties}>
        <p className={s.madeLine}>
          Started by War Room · <b className="tabular-nums">{signed(move.gain)}</b> proj
        </p>
        <p className={s.madeWeek}>
          War Room moves this week: <b className="tabular-nums">{signed(week)}</b> proj
        </p>
      </div>
    </>
  );
}

/** A bench player: tap his BN to move him into a slot. */
function BenchRow({ draft, player }: { draft: LineupDraft; player: ViewPlayer }) {
  const seat = draft.staged.indexOf(player.playerId);
  const group = draft.changeOf.get(player.playerId);
  const moving = seat >= 0 && (!group || draft.isPicked(group));
  const toIr = draft.ir.includes(player.playerId);
  return (
    <li className={s.row} data-moving={moving || toIr}>
      <span className={s.rowSlot}>
        <BenchPicker draft={draft} player={player} />
      </span>
      <span className={s.rowPlayer}>
        <PlayerLine player={player} locked={player.locked} value="none" news ownership live stacked />
        {(moving || toIr) && <span className={s.rowChip}>{toIr ? "Going on IR" : `Starting at ${SLOT_LABEL[draft.seats[seat]]}`}</span>}
      </span>
      <Points player={player} />
    </li>
  );
}

/** A slot pill that opens a popover anchored to it. Disabled where ESPN won't move anyone. */
function Picker({ label: text, disabled, title, children }: { label: string; disabled: boolean; title: string; children: (close: () => void) => React.ReactNode }) {
  const id = useId();
  const anchor = `--pick${id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const close = () => document.getElementById(id)?.hidePopover();
  return (
    <>
      <button
        type="button"
        className={s.slotPill}
        popoverTarget={id}
        disabled={disabled}
        aria-label={disabled ? `${text}: locked, his game has started` : `${text}: change who plays here`}
        style={{ anchorName: anchor } as CSSProperties}
      >
        {text}
      </button>
      <div id={id} popover="auto" className={s.picker} style={{ positionAnchor: anchor } as CSSProperties}>
        <p className={s.pickerHead}>{title}</p>
        <ul className={s.pickerList}>{children(close)}</ul>
      </div>
    </>
  );
}

/**
 * Who can play a starting seat: anyone eligible and not on IR. War Room's pick for the seat leads and
 * says so, then ESPN's player there; everyone else says where picking him takes him from.
 */
function SeatPicker({ draft, seat, label: text }: { draft: LineupDraft; seat: number; label: string }) {
  const key = draft.seats[seat];
  const current = draft.staged[seat];
  const ours = draft.recommended[seat];
  const espn = draft.onEspn[seat];
  const holder = current === null ? undefined : draft.byId.get(current);
  const rank = (id: number) => (id === ours ? 0 : id === espn ? 1 : 2);
  const options = draft.roster
    .filter((p) => !draft.ir.includes(p.playerId) && canPlay(p.pos, key) && (!p.locked || p.playerId === current))
    .sort((a, b) => rank(a.playerId) - rank(b.playerId) || b.points - a.points);
  return (
    <Picker label={text} disabled={!!holder?.locked} title={`Who plays ${text}`}>
      {(close) => (
        <>
          {options.map((p) => {
            const at = draft.staged.indexOf(p.playerId);
            const where = at === seat ? null : at >= 0 ? `Starting at ${SLOT_LABEL[draft.seats[at]]}` : "On the bench";
            return (
              <li key={p.playerId}>
                <button
                  type="button"
                  className={s.pickerOption}
                  aria-current={p.playerId === current}
                  data-ours={p.playerId === ours || undefined}
                  onClick={() => {
                    if (p.playerId !== current) draft.choose(seat, p.playerId);
                    close();
                  }}
                >
                  <span className={s.pickerWho}>
                    <PlayerLine player={p} value="none" live />
                    <span className={s.pickerTags}>
                      {p.playerId === ours && <span className={s.pickerOurs}>War Room&apos;s pick</span>}
                      {p.playerId === espn && <span className={s.pickerEspn}>On ESPN at {text}</span>}
                      {where && p.playerId !== espn && <span>{where}</span>}
                    </span>
                  </span>
                  <span className={s.pickerRight}>
                    <span className={`${s.rowPts} tabular-nums`}>{pts(p.points)}</span>
                    {p.playerId === current && (
                      <span className={s.pickerChosen}>
                        <Check /> Chosen
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          {current !== null && (
            <li>
              <button
                type="button"
                className={`${s.pickerOption} ${s.pickerEmpty}`}
                onClick={() => {
                  draft.choose(seat, null);
                  close();
                }}
              >
                Leave {text} empty
              </button>
            </li>
          )}
        </>
      )}
    </Picker>
  );
}

/** Where a bench player can go: the seats he's eligible for, with who's staged there now. */
function BenchPicker({ draft, player }: { draft: LineupDraft; player: ViewPlayer }) {
  const at = draft.staged.indexOf(player.playerId);
  const seats = draft.seats.flatMap((key, i) => {
    const holder = draft.staged[i] === null ? undefined : draft.byId.get(draft.staged[i]!);
    return canPlay(player.pos, key as LineupSlot) && !holder?.locked && i !== at ? [{ key, i, holder }] : [];
  });
  return (
    <Picker label="BN" disabled={player.locked || draft.ir.includes(player.playerId)} title={`Where ${player.name} starts`}>
      {(close) => (
        <>
          {seats.map(({ key, i, holder }) => (
            <li key={`${key}-${i}`}>
              <button
                type="button"
                className={s.pickerOption}
                onClick={() => {
                  draft.choose(i, player.playerId);
                  close();
                }}
              >
                <span className={s.pickerWho}>
                  <b>
                    {SLOT_LABEL[key]}, {holder ? <>over {holder.name}</> : "empty now"}
                  </b>
                  {draft.recommended[i] === player.playerId && (
                    <span className={s.pickerTags}>
                      <span className={s.pickerOurs}>War Room&apos;s pick</span>
                    </span>
                  )}
                </span>
                {holder && <span className={`${s.rowPts} tabular-nums`}>{pts(holder.points)}</span>}
              </button>
            </li>
          ))}
          {at >= 0 && (
            <li>
              <button
                type="button"
                className={`${s.pickerOption} ${s.pickerEmpty}`}
                onClick={() => {
                  draft.choose(at, draft.onEspn[at]);
                  close();
                }}
              >
                Keep him on the bench
              </button>
            </li>
          )}
          {!seats.length && at < 0 && <li className={s.fine}>No open slot he can play.</li>}
        </>
      )}
    </Picker>
  );
}

/** The lineup's other tools: IR, and starting over from ESPN's lineup or War Room's. */
function LineupMenu({ draft, irSlots }: { draft: LineupDraft; irSlots: number }) {
  const id = useId();
  const close = () => document.getElementById(id)?.hidePopover();
  if (!irSlots && draft.isOnEspn && draft.isRecommended) return null;
  return (
    <>
      <button type="button" className={s.textButton} popoverTarget={id}>
        More
      </button>
      <div id={id} popover="auto" className={`${s.picker} ${s.menu}`}>
        <p className={s.pickerHead}>Your lineup</p>
        <div className={s.seatSources}>
          {!draft.isOnEspn && (
            <button
              type="button"
              className={s.textButton}
              onClick={() => {
                draft.startFrom(draft.onEspn);
                close();
              }}
            >
              Start from ESPN&apos;s lineup
            </button>
          )}
          {!draft.isRecommended && (
            <button
              type="button"
              className={s.textButton}
              onClick={() => {
                draft.startFrom(draft.recommended);
                close();
              }}
            >
              Start from War Room&apos;s lineup
            </button>
          )}
        </div>
        {irSlots > 0 && <IrPicker roster={draft.roster} ir={draft.ir} irSlots={irSlots} onToggle={draft.toggleIr} />}
      </div>
    </>
  );
}

/**
 * This week's fantasy matchup (APE-211), in ESPN's own numbers: points so far once games start, and
 * ESPN's projection for the lineups set on ESPN, which isn't War Room's lineup until the user moves it.
 */
function MatchupCard({ view }: { view: SeasonView }) {
  const { me, them } = view.matchup!;
  const opponent = view.teams.find((t) => t.id === them.teamId)?.name ?? "Your opponent";
  const started = me.points > 0 || them.points > 0;
  const side = (name: string, team: typeof me, mine: boolean) => (
    <div className={s.side} data-mine={mine}>
      <span className={s.sideName}>{name}</span>
      <b className={`${s.sideScore} tabular-nums`}>{pts(started ? team.points : team.projected)}</b>
      <span className={s.sideSub}>{started ? <>proj <span className="tabular-nums">{pts(team.projected)}</span></> : "projected"}</span>
    </div>
  );
  return (
    <section className={`${s.panel} ${s.orderMatchup}`} aria-labelledby="matchup-title">
      <div className={s.panelHead}>
        <h2 id="matchup-title" className={s.panelTitle}>
          Week {view.currentWeek} matchup
        </h2>
        <span className={s.panelNote}>ESPN&apos;s numbers</span>
      </div>
      <div className={s.matchup}>
        {side("You", me, true)}
        <span className={s.matchupVs} aria-hidden>
          vs
        </span>
        {side(opponent, them, false)}
      </div>
      <p className={`${s.fine} ${s.matchupFoot}`}>
        {me.winProbability !== null && (
          <>
            ESPN gives you a <b className="tabular-nums">{Math.round(me.winProbability * 100)}%</b> chance to win.{" "}
          </>
        )}
        Projections are for the lineups set on ESPN now.
      </p>
    </section>
  );
}

