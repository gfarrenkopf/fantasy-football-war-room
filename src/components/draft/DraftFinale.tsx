"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { byeWeekList } from "@/lib/draft/roster";
import { roundsOf } from "@/lib/draft/snake";
import { draftWrap, type DraftWrap, type WrapPick } from "@/lib/draft/wrap";
import { POS_COLOR } from "./Board";
import { cx, s } from "./cx";
import { useDraft } from "./DraftProvider";
import { useModel } from "./DraftModel";
import { useLeague } from "./LeagueProvider";
import { Confetti, CountUp, ordinal, stage, useReducedMotion } from "./OpeningNight";
import { posLabel } from "./PlayerCard";
import { usePrefs } from "./PrefsProvider";
import { drawTeamCard, saveTeamCard } from "./teamCard";
import { useToast } from "./Feedback";

interface Show {
  wrap: DraftWrap;
  mock: boolean;
  name: string;
  season: number;
  teams: number;
  rounds: number;
}

/**
 * The final whistle: when the last pick of a real draft lands, the room goes dark once more and
 * reveals the team the user just built — the bookend to Opening Night, on the same stage, and the
 * bigger of the two. "That's a wrap" slams in, the starting lineup deals in card by card, the steal
 * of the draft gets both spotlights and the confetti, a two-line report card follows, and the team
 * card is theirs to keep. It plays once per league (an undo and re-log doesn't replay it) and never
 * on reloading a finished draft. A mock draft gets a short card instead.
 */
export function DraftFinale() {
  const model = useModel();
  const { state, hydrated } = useDraft();
  const { prefs, setPrefs } = usePrefs();
  const { active } = useLeague();
  const [show, setShow] = useState<Show | null>(null);

  // Read by the transition check without re-running it on every pick.
  const latest = useRef({ model, state, prefs, active });
  useEffect(() => {
    latest.current = { model, state, prefs, active };
  });

  // The draft's `done` when it first loaded: a finished draft reopened is not a finish.
  const was = useRef<boolean | null>(null);
  const done = model.done;
  useEffect(() => {
    if (!hydrated) return;
    if (was.current === null) {
      was.current = done;
      return;
    }
    const finished = !was.current && done;
    was.current = done;
    if (!finished) return;
    const { model: m, state: st, prefs: p, active: league } = latest.current;
    const mock = p.mockOn;
    if (!mock && league) {
      if (p.wrapped.includes(league.id)) return;
      // Marked as it starts: an undo and re-log of the last pick doesn't replay the show.
      setPrefs({ wrapped: [...p.wrapped, league.id] });
    }
    const next: Show = {
      wrap: draftWrap(m.slots, m.league.teams, byeWeekList(m.dataset.byeWeeks)),
      mock,
      name: league?.name ?? "Your league",
      season: league?.season ?? m.dataset.season,
      teams: m.league.teams,
      rounds: roundsOf(m.league),
    };
    // The user's own last pick gets its pick card first; then the lights go down.
    const t = setTimeout(() => setShow(next), st.picks.at(-1)?.mine && !mock ? 1100 : 150);
    return () => clearTimeout(t);
  }, [hydrated, done, setPrefs]);

  const close = useCallback(() => setShow(null), []);
  if (!show) return null;
  return show.mock ? <MockWrap show={show} onDone={close} /> : <Finale show={show} onDone={close} />;
}

/** When each beat lands, in ms from the lights going down; the lineup's length sets the rest. */
const beatsFor = (starters: number) => {
  const dealt = 1700 + starters * 110 + 420;
  return { title: 250, slam: 550, league: 1200, lineup: 1700, steal: dealt + 200, report: dealt + 1500, actions: dealt + 2100 };
};

function Finale({ show, onDone }: { show: Show; onDone(): void }) {
  const { wrap } = show;
  const reduced = useReducedMotion();
  const toast = useToast();
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useRef<HTMLButtonElement>(null);
  const headline = wrap.steal ?? wrap.best;
  const FINAL = 7;
  const at = (n: number) => beat >= n;

  const end = useCallback(() => {
    if (leaving) return;
    if (reduced) return onDone();
    // Iris down onto the header's pick box, the way Opening Night leaves.
    const box = document.querySelector<HTMLElement>("[data-pickbox]")?.getBoundingClientRect();
    setLeaving(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: window.innerWidth / 2, y: 40 });
    setTimeout(onDone, 720);
  }, [leaving, reduced, onDone]);

  // The run of show. Reduced motion lands on the final state at once.
  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => setBeat(FINAL), 0);
      return () => clearTimeout(t);
    }
    const b = beatsFor(wrap.starters.length);
    const marks = [b.title, b.slam, b.league, b.lineup, b.steal, b.report, b.actions];
    const timers = marks.map((ms, i) => setTimeout(() => setBeat((n) => Math.max(n, i + 1)), ms));
    timers.push(setTimeout(() => navigator.vibrate?.([60, 50, 60, 50, 60, 90, 220]), b.steal));
    return () => timers.forEach(clearTimeout);
  }, [reduced, wrap.starters.length]);

  useEffect(() => {
    if (beat >= FINAL) save.current?.focus({ preventScroll: true });
  }, [beat]);

  // Mid-show, any key or tap skips to the finished reveal; once it's all on stage, Esc closes it.
  const skip = beat < FINAL;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Tab") return;
      if (skip) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setBeat(FINAL);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        end();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [skip, end]);

  const keep = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const blob = await drawTeamCard(wrap, { season: show.season, league: show.name, teams: show.teams, stageFamily: stage.style.fontFamily });
      const slug = show.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "draft";
      const how = await saveTeamCard(blob, `${slug}-${show.season}-team.png`);
      if (how === "saved") toast("Team card saved");
    } catch {
      toast("Couldn't make the team card. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const stacked = wrap.stacked;
  return (
    <div
      className={cx("opening", "finale", leaving && "irisOut", reduced && "still")}
      style={leaving ? ({ "--iris-x": `${leaving.x}px`, "--iris-y": `${leaving.y}px` } as React.CSSProperties) : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="finale-title"
      onClick={() => skip && setBeat(FINAL)}
    >
      {/* The font's class isn't in this module, so it is joined by hand: cx() would drop it. */}
      <div className={`${s.openingInner} ${s.finaleInner} ${stage.variable}`}>
        <div className={cx("beams", at(5) && "converge")} aria-hidden="true">
          <i />
          <i />
        </div>
        {at(5) && !reduced && <Confetti life={3600} density={1.25} />}

        <button type="button" className={s.openingSkip} onClick={end}>
          {skip ? "Skip" : "Close"}
        </button>

        <div className={cx("finaleStage", at(2) && !reduced && "shake")}>
          <h1 id="finale-title" className={s.openingTitle}>
            <span className={cx("otYear", at(1) && "in")}>The {show.season} Draft</span>
            <span className={cx("otDraft", "fnWrap", at(2) && "in")}>That&apos;s a wrap</span>
          </h1>
          <p className={cx("otLeague", at(3) && "in")}>
            {show.name} · {show.teams} teams · {show.rounds} rounds · in the books
          </p>

          <div className={s.fnBody}>
            <section className={s.fnLineup} aria-label="Your starting lineup">
              <ol>
                {wrap.starters.map((p, i) => (
                  <LineupCard key={p.player.id} p={p} i={i} dealt={at(4)} star={at(5) && headline?.player.id === p.player.id} />
                ))}
              </ol>
              {wrap.bench.length > 0 && (
                <p className={cx("fnBench", at(4) && "in")} style={{ animationDelay: `${wrap.starters.length * 110}ms` }}>
                  + {wrap.bench.length} on the bench
                </p>
              )}
            </section>

            <div className={s.fnSide}>
              {headline && (
                <section className={cx("fnSteal", at(5) && "in")} aria-label={wrap.steal ? "Steal of the draft" : "Best pick"}>
                  <p className={s.fnSlab}>{wrap.steal ? "Steal of the draft" : "Best pick"}</p>
                  <p className={s.fnStar} style={{ "--pos": POS_COLOR[headline.player.pos] } as React.CSSProperties}>
                    {headline.player.name}
                  </p>
                  <p className={s.fnStarMeta}>
                    {posLabel(headline.player.pos)} · {headline.player.team} · {headline.roundPick}
                  </p>
                  {wrap.steal ? (
                    <>
                      <p className={s.fnStory}>
                        Experts ranked him <b>{ordinal(headline.player.consensusRank)}</b>. You got him <b>{ordinal(headline.player.pickNo)}</b>.
                      </p>
                      <p className={s.fnGain}>
                        <span>+{at(5) ? <CountUp to={headline.gain!} delay={380} still={reduced} /> : 0}</span>
                        <small>picks of value</small>
                      </p>
                    </>
                  ) : (
                    <p className={s.fnStory}>
                      The best-ranked player on your team: <b>{ordinal(headline.player.consensusRank)}</b> by consensus.
                    </p>
                  )}
                </section>
              )}

              <ul className={cx("fnReport", at(6) && "in")} aria-label="Report card">
                <li>
                  <b>
                    {wrap.beat.k} of {wrap.beat.n}
                  </b>{" "}
                  picks came after the experts&apos; rank
                </li>
                <li className={cx(stacked.length > 0 && "warn")}>
                  {stacked.length
                    ? stacked.map((w) => `Week ${w.week}: ${w.n} starters out`).join(" · ")
                    : "No stacked bye weeks among your starters"}
                </li>
              </ul>

              <div className={cx("fnActions", at(7) && "in")}>
                <button ref={save} type="button" className={s.otGo} onClick={() => void keep()} disabled={saving}>
                  {saving ? "Drawing…" : "Save team card"}
                </button>
                <button type="button" className={s.fnBack} onClick={end}>
                  Back to the room
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LineupCard({ p, i, dealt, star }: { p: WrapPick; i: number; dealt: boolean; star: boolean }) {
  const gain = p.gain;
  return (
    <li
      className={cx("fnCard", dealt && "in", star && "star")}
      style={{ "--pos": POS_COLOR[p.player.pos], animationDelay: `${i * 110}ms` } as React.CSSProperties}
    >
      <span className={s.fnSlot}>{p.slot}</span>
      <span className={s.fnWho}>
        <b>{p.player.name}</b>
        <small>
          {posLabel(p.player.pos)} · {p.player.team} · {p.roundPick}
        </small>
      </span>
      <span className={cx("fnDelta", gain === null ? "na" : gain > 0 ? "up" : gain < 0 && "down")} title="Picks after the consensus rank">
        {gain === null ? "—" : gain > 0 ? `+${gain}` : gain}
      </span>
    </li>
  );
}

/** A mock that finishes gets a short card in the pick card's place, not the show. */
function MockWrap({ show, onDone }: { show: Show; onDone(): void }) {
  const { wrap } = show;
  const headline = wrap.steal ?? wrap.best;
  const life = 5200;
  useEffect(() => {
    const t = setTimeout(onDone, life);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      className={`${s.pickCard} ${s.mockWrap} ${stage.variable}`}
      style={{ "--life": `${life}ms` } as React.CSSProperties}
      role="status"
      aria-live="polite"
      onClick={onDone}
      title="Tap to dismiss"
    >
      <b className={s.mwTitle}>Mock complete</b>
      {headline && (
        <p className={s.mwLine}>
          {wrap.steal ? "Steal" : "Best pick"}: <b>{headline.player.name}</b>
          {wrap.steal ? ` at ${headline.roundPick}, +${headline.gain} on consensus` : ` at ${headline.roundPick}`}
        </p>
      )}
      <p className={s.mwLine}>
        {wrap.beat.k} of {wrap.beat.n} picks beat consensus{wrap.stacked.length ? ` · week ${wrap.stacked[0].week} stacked` : ""}
      </p>
      <i className={s.pcLife} aria-hidden="true" />
    </div>
  );
}
