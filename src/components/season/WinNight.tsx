"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stage } from "@/components/draft/stageFont";
import { CountUp, StageConfetti, useReducedMotion } from "@/components/draft/stageKit";
import type { WeekRecap } from "@/lib/season/recap";
import { pts, signed, SLOT_LABEL } from "./parts";
import s from "./season.module.css";
import { saveWinCard } from "./winCard";

const POS_HUE: Record<string, string> = {
  QB: "var(--color-qb)",
  RB: "var(--color-rb)",
  WR: "var(--color-wr)",
  TE: "var(--color-te)",
  K: "var(--color-k)",
  DST: "var(--color-dst)",
};

/** How long the two scores race up, in ms. Both climb at one rate, so the lower one stops first. */
const RACE_MS = 1900;
const DEAL_MS = 95;

/** When each beat lands, in ms from the lights going down; the lineup's length sets the rest. */
const beatsFor = (starters: number) => {
  const race = 1150;
  const margin = race + RACE_MS + 150;
  const lineup = margin + 450;
  const star = lineup + starters * DEAL_MS + 450;
  return { week: 250, slam: 620, race, margin, lineup, star, actions: star + 1500 };
};
const FINAL = 7;

/**
 * Win night (APE-230): the first time the user opens the season page after winning a week, the
 * room goes dark and the draft room's stage comes back for them. The week rises in Terminal Sky, a
 * giant W slams onto the stage and shakes it, then both scores race up side by side: the
 * opponent's stops, the user's keeps climbing past it, and the margin wipes in on the green slab.
 * The starters are dealt face up with their points, the follow-spots swing onto the star of the
 * week, the confetti goes off and the phone buzzes. It ends on the win card for the group chat.
 *
 * Any key or tap mid-show jumps to the finished state; Esc, Close or "Back to game day" irises it
 * down into the result panel. Reduced motion gets the finished state at once, still.
 */
export function WinNight({ recap, league, onDone }: { recap: WeekRecap; league: string; onDone(): void }) {
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState<"idle" | "drawing" | "saved" | "failed">("idle");
  const save = useRef<HTMLButtonElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const starRef = useRef<HTMLElement>(null);
  const race = useRef<HTMLDivElement>(null);
  const mine = useRef<HTMLElement>(null);
  const theirs = useRef<HTMLElement>(null);
  const at = (n: number) => beat >= n;
  const star = recap.star;

  const end = useCallback(() => {
    if (leaving) return;
    if (reduced) return onDone();
    // Iris down onto the result panel the show leaves behind.
    const panel = document.getElementById("moment-title")?.getBoundingClientRect();
    setLeaving(panel ? { x: panel.left + 80, y: panel.top + panel.height / 2 } : { x: window.innerWidth / 2, y: 120 });
    setTimeout(onDone, 720);
  }, [leaving, reduced, onDone]);

  // The run of show. Reduced motion lands on the final state at once.
  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => setBeat(FINAL), 0);
      return () => clearTimeout(t);
    }
    const b = beatsFor(recap.starters.length);
    const marks = [b.week, b.slam, b.race, b.margin, b.lineup, b.star, b.actions];
    const timers = marks.map((ms, i) => setTimeout(() => setBeat((n) => Math.max(n, i + 1)), ms));
    timers.push(setTimeout(() => navigator.vibrate?.(35), b.slam + 120));
    timers.push(setTimeout(() => navigator.vibrate?.([60, 50, 60, 50, 60, 90, 240]), b.star));
    return () => timers.forEach(clearTimeout);
  }, [reduced, recap.starters.length]);

  // The race: both scores climb at one rate toward their finals. The opponent's stops and dims;
  // the moment the user's passes it, the race flashes and the phone ticks.
  const racing = beat >= 3 && beat < FINAL && !reduced;
  const settled = beat >= FINAL || reduced;
  useEffect(() => {
    const box = race.current;
    const a = mine.current;
    const b = theirs.current;
    if (!box || !a || !b) return;
    // The numbers are written here, never by React, so the race and a skip can't fight over them.
    if (settled || !racing) {
      a.textContent = pts(settled ? recap.me : 0);
      b.textContent = pts(settled ? recap.them : 0);
      if (settled) {
        box.dataset.passed = "true";
        b.dataset.done = "true";
      }
      return;
    }
    const top = Math.max(recap.me, recap.them, 1);
    const start = performance.now();
    let passed = false;
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / RACE_MS);
      // Eased so the finish line arrives with weight, not at a constant crawl.
      const level = top * (1 - Math.pow(1 - t, 2.2));
      const me = Math.min(recap.me, level);
      const them = Math.min(recap.them, level);
      a.textContent = pts(me);
      b.textContent = pts(them);
      if (them >= recap.them) b.dataset.done = "true";
      if (!passed && me > recap.them) {
        passed = true;
        box.dataset.passed = "true";
        navigator.vibrate?.([18, 40, 18]);
      }
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [racing, settled, recap.me, recap.them]);

  useEffect(() => {
    if (beat >= FINAL) save.current?.focus({ preventScroll: true });
  }, [beat]);

  // When the star lands below the fold (a laptop screen, a phone), the camera follows it down.
  const starIn = beat >= 6;
  useEffect(() => {
    const box = inner.current;
    const el = starRef.current;
    if (!starIn || !box || !el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const goal = Math.max(0, Math.min(top - 32, box.scrollHeight - box.clientHeight));
    if (goal > box.scrollTop + 8) box.scrollTo({ top: goal, behavior: reduced ? "auto" : "smooth" });
  }, [starIn, reduced]);

  // Mid-show, any key or tap skips to the finished state; once it's all on stage, Esc closes it.
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
    if (saving === "drawing") return;
    setSaving("drawing");
    try {
      const how = await saveWinCard(recap, league);
      setSaving(how === "cancelled" ? "idle" : "saved");
    } catch {
      setSaving("failed");
    }
  };

  return (
    <div
      className={[s.wn, leaving && s.wnIrisOut, reduced && s.wnStill].filter(Boolean).join(" ")}
      style={leaving ? ({ "--iris-x": `${leaving.x}px`, "--iris-y": `${leaving.y}px` } as React.CSSProperties) : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="win-title"
      onClick={() => skip && setBeat(FINAL)}
    >
      <div ref={inner} className={`${s.wnInner} ${stage.variable}`}>
        <div className={[s.wnBeams, at(6) && s.wnConverge].filter(Boolean).join(" ")} aria-hidden="true">
          <i />
          <i />
        </div>
        {at(6) && !reduced && <StageConfetti className={s.wnConfetti} life={4200} density={1.8} />}

        <button type="button" className={s.wnSkip} onClick={end}>
          {skip ? "Skip" : "Close"}
        </button>

        <div className={[s.wnStage, at(2) && !reduced && s.wnShake].filter(Boolean).join(" ")}>
          <p className={[s.wnWeek, at(1) && s.in].filter(Boolean).join(" ")}>
            Week {recap.week} · {league}
          </p>
          <h1 id="win-title" className={[s.wnW, at(2) && s.in].filter(Boolean).join(" ")}>
            <span aria-hidden="true">W</span>
            <span className="sr-only">
              You won week {recap.week}, {pts(recap.me)} to {pts(recap.them)}
            </span>
          </h1>

          <div ref={race} className={[s.wnRace, at(3) && s.in].filter(Boolean).join(" ")}>
            <div className={s.wnSide} data-mine="true">
              <span className={s.wnName}>You</span>
              <b ref={mine} className={s.wnScore} />
            </div>
            <span className={s.wnVs} aria-hidden="true">
              vs
            </span>
            <div className={s.wnSide}>
              <span className={s.wnName}>{recap.opponent}</span>
              <b ref={theirs} className={s.wnScore} />
            </div>
          </div>

          <p className={[s.wnMargin, at(4) && s.in].filter(Boolean).join(" ")}>Won by {pts(recap.margin)}</p>

          <div className={s.wnBody}>
            <ol className={s.wnLineup} aria-label="Your starters">
              {recap.starters.map((p, i) => {
                const tone = p.points >= p.projected ? "up" : p.points < p.projected * 0.7 ? "down" : "even";
                return (
                  <li
                    key={p.playerId}
                    className={[s.wnCard, at(5) && s.in, at(6) && star?.player.playerId === p.playerId && s.wnCardStar].filter(Boolean).join(" ")}
                    style={{ "--pos": POS_HUE[p.pos], animationDelay: `${i * DEAL_MS}ms` } as React.CSSProperties}
                  >
                    <span className={s.wnSlot}>{SLOT_LABEL[p.slot]}</span>
                    <span className={s.wnWho}>
                      <b>{p.name}</b>
                      <small>
                        {p.team ?? "FA"} · proj {pts(p.projected)}
                      </small>
                    </span>
                    <span className={s.wnPts} data-tone={tone}>
                      {pts(p.points)}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className={s.wnAside}>
              {star && (
                <section ref={starRef} className={[s.wnStar, at(6) && s.in].filter(Boolean).join(" ")} aria-label="Star of the week">
                  <p className={s.wnSlab}>Star of the week</p>
                  <p className={s.wnStarName} style={{ "--pos": POS_HUE[star.player.pos] } as React.CSSProperties}>
                    {star.player.name}
                  </p>
                  <p className={s.wnStarMeta}>
                    {star.player.pos === "DST" ? "D/ST" : star.player.pos} · {star.player.team ?? "FA"}
                    {star.player.slot !== star.player.pos && ` · at ${SLOT_LABEL[star.player.slot]}`}
                  </p>
                  {star.beat ? (
                    <>
                      <p className={s.wnStory}>
                        ESPN had him at <b>{pts(star.player.projected)}</b>. He gave you <b>{pts(star.player.points)}</b>.
                      </p>
                      <p className={s.wnGain}>
                        <span>
                          {at(6) ? (
                            <>
                              +<CountUp to={star.player.points - star.player.projected} delay={420} still={reduced} decimals={1} ms={900} />
                            </>
                          ) : (
                            signed(0)
                          )}
                        </span>
                        <small>over the call</small>
                      </p>
                    </>
                  ) : (
                    <p className={s.wnStory}>
                      <b>{pts(star.player.points)}</b> points, the most of your starters.
                    </p>
                  )}
                </section>
              )}

              <div className={[s.wnActions, at(7) && s.in].filter(Boolean).join(" ")}>
                <button ref={save} type="button" className={s.wnGo} onClick={() => void keep()} disabled={saving === "drawing"}>
                  {saving === "drawing" ? "Drawing…" : saving === "saved" ? "Saved. Again?" : "Save win card"}
                </button>
                <button type="button" className={s.wnBack} onClick={end}>
                  Back to game day
                </button>
                {saving === "failed" && (
                  <p className={s.wnFail} role="status">
                    Couldn&apos;t make the win card. Try again.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
