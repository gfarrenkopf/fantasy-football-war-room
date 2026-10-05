"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { roundsOf, totalPicks } from "@/lib/draft/snake";
import { cx, s } from "./cx";
import { getStores } from "@/lib/storage";
import { seedPremiered, shouldPremiere } from "@/lib/storage/premiere";
import { useLeague } from "./LeagueProvider";
import { usePrefs } from "./PrefsProvider";

import { CountUp, StageConfetti, useReducedMotion } from "./stageKit";
import { stage } from "./stageFont";

export { CountUp, stage, useReducedMotion };

/** The stage's confetti in the war room's layer. */
export const Confetti = (props: Omit<React.ComponentProps<typeof StageConfetti>, "className"> & { className?: string }) => (
  <StageConfetti {...props} className={props.className ?? s.confetti} />
);

/** When each beat lands, in ms from the lights going down. */
const BEAT = { title: 250, slam: 520, league: 1250, stats: 1650, slot: 2750, clock: 3700, out: 6200 } as const;

export const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
};

/**
 * Opening night: the first time a new league opens on this device, before any pick is logged —
 * however it was made: the landing page, league setup here, or an ESPN import — the war room goes dark and announces the draft the way the league announces its own — lights up, the
 * year slammed onto the stage, the league's shape counted onto the board, your slot called, the
 * position colors going off in both corners — then the clock starts and the whole stage irises
 * down into the header's pick box, where the real clock lives.
 *
 * It is the product's one deliberate break from the room's muted grammar (DESIGN.md, "Opening
 * Night"). It runs once per new league, never again; any key, a tap, or "Skip" ends it; reduced
 * motion gets the same announcement as a still card. Every number on it is the league's own.
 */
export function OpeningNight() {
  const { active, leagues, hydrated } = useLeague();
  const { prefs, setPrefs } = usePrefs();
  const reduced = useReducedMotion();
  const [show, setShow] = useState<null | { name: string; season: number; teams: number; rounds: number; total: number; slot: number }>(null);
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState<{ x: number; y: number } | null>(null);
  const fresh = useRef<string | null | undefined>(undefined);
  const checked = useRef(new Set<string>());
  const cta = useRef<HTMLButtonElement>(null);
  // Read by the check below without re-running it: marking a league premiered mustn't cancel its show.
  const latest = useRef({ active, premiered: prefs.premiered });
  useEffect(() => {
    latest.current = { active, premiered: prefs.premiered };
  });

  // Read (and strip) the one-time parameter the landing page sets on the league it just made, and
  // seed a device from before premieres were kept (see premiere.ts).
  useEffect(() => {
    if (!hydrated) return;
    if (fresh.current === undefined) {
      const url = new URL(window.location.href);
      fresh.current = url.searchParams.get("new") === "1" ? (active?.id ?? null) : null;
      if (url.searchParams.has("new")) {
        url.searchParams.delete("new");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }
    if (prefs.premiered === null) setPrefs({ premiered: seedPremiered(leagues.map((l) => l.id), fresh.current) });
  }, [hydrated, active, leagues, prefs.premiered, setPrefs]);

  // Whether the league now open premieres. Once per league per visit, as leagues load and switch.
  const seeded = prefs.premiered !== null;
  const activeId = active?.id ?? null;
  useEffect(() => {
    const seen = checked.current;
    if (!hydrated || !seeded || !activeId || seen.has(activeId)) return;
    seen.add(activeId);
    let live = true;
    void getStores()
      .draft.getDraftState(activeId)
      .then((draft) => {
        const { active: league, premiered } = latest.current;
        if (!live || !league || league.id !== activeId || !premiered) return;
        if (!shouldPremiere(premiered, league.id, draft?.picks.length ?? 0)) return;
        // Marked as it starts, not as it ends: a reload mid-show doesn't run it again.
        setPrefs({ premiered: [...premiered, league.id] });
        const settings = league.settings;
        // Set from a timeout so the stage mounts after the war room's first paint, not in front of it.
        setTimeout(() =>
          setShow({
            name: league.name,
            season: league.season,
            teams: settings.teams,
            rounds: roundsOf(settings),
            total: totalPicks(settings),
            slot: settings.mySlot,
          }),
        );
      });
    return () => {
      // Switched away before the draft was read: look again if this league opens later.
      if (live) seen.delete(activeId);
      live = false;
    };
  }, [hydrated, seeded, activeId, setPrefs]);

  const end = useCallback(() => {
    if (leaving) return;
    if (reduced) return setShow(null);
    // Iris down onto the header's pick box: the clock the stage just started is the one up there.
    const box = document.querySelector<HTMLElement>("[data-pickbox]")?.getBoundingClientRect();
    setLeaving(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: window.innerWidth / 2, y: 40 });
    setTimeout(() => setShow(null), 720);
  }, [leaving, reduced]);

  // The run of show. Reduced motion lands on the final beat at once.
  useEffect(() => {
    if (!show) return;
    if (reduced) {
      const t = setTimeout(() => setBeat(99), 0);
      return () => clearTimeout(t);
    }
    const marks = [BEAT.title, BEAT.slam, BEAT.league, BEAT.stats, BEAT.slot, BEAT.clock];
    const timers = marks.map((ms, i) => setTimeout(() => setBeat(i + 1), ms));
    timers.push(setTimeout(end, BEAT.out));
    // The phones that can, feel the slot get called.
    timers.push(setTimeout(() => navigator.vibrate?.([40, 60, 40, 60, 140]), BEAT.slot));
    return () => timers.forEach(clearTimeout);
  }, [show, reduced, end]);

  useEffect(() => {
    if (beat >= 6 || beat === 99) cta.current?.focus({ preventScroll: true });
  }, [beat]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      // Tab still moves between Skip and "Let's draft"; every other key ends the show.
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Tab") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      end();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [show, end]);

  if (!show) return null;
  const at = (n: number) => beat >= n;
  const first = show.slot === 1;

  return (
    <div
      className={cx("opening", leaving && "irisOut", reduced && "still")}
      style={leaving ? ({ "--iris-x": `${leaving.x}px`, "--iris-y": `${leaving.y}px` } as React.CSSProperties) : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="opening-title"
      aria-describedby="opening-slot"
      onClick={() => at(3) && end()}
    >
      {/* The font's class isn't in this module, so it is joined by hand: cx() would drop it. */}
      <div className={`${s.openingInner} ${stage.variable}`}>
        <div className={s.beams} aria-hidden="true">
          <i />
          <i />
        </div>
        {at(5) && !reduced && <Confetti />}

        <button type="button" className={s.openingSkip} onClick={end}>
          Skip
        </button>

        <div className={cx("openingStage", at(2) && "shake")}>
          <h1 id="opening-title" className={s.openingTitle}>
            <span className={cx("otYear", at(1) && "in")}>The {show.season}</span>
            <span className={cx("otDraft", at(2) && "in")}>Draft</span>
          </h1>
          <p className={cx("otLeague", at(3) && "in")}>{show.name} · welcome to the war room</p>

          <dl className={s.otStats}>
            {[
              { n: show.teams, label: "teams" },
              { n: show.rounds, label: "rounds" },
              { n: show.total, label: "picks" },
            ].map((stat, i) => (
              <div key={stat.label} className={cx("otStat", at(4) && "in")} style={{ animationDelay: `${i * 170}ms` }}>
                <dt>{stat.label}</dt>
                <dd>{at(4) || reduced ? <CountUp to={stat.n} delay={i * 170} still={reduced} /> : 0}</dd>
              </div>
            ))}
          </dl>

          <p id="opening-slot" className={cx("otSlot", at(5) && "in")}>
            {first ? "You're on the clock" : `You pick ${ordinal(show.slot)}`}
          </p>

          <div className={cx("otClock", at(6) && "in")}>
            <p>
              The clock is running.{" "}
              {first ? "Pick 1 is yours." : `${show.slot - 1} pick${show.slot - 1 === 1 ? "" : "s"} until you're up.`} Log each pick as it goes off
              the board.
            </p>
            <button ref={cta} type="button" className={s.otGo} onClick={end}>
              Let&apos;s draft →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
