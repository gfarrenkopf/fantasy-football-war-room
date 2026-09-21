"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CPU_STYLES, defaultRoom, roomFor, simulateFrom, slotForRoomIndex, STYLES } from "@/lib/draft/sim";
import type { CpuStyle, DraftPick } from "@/lib/draft/types";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { useDraft } from "./DraftProvider";
import { useEspnSync } from "./EspnSync";
import { useToast } from "./Feedback";
import { usePrefs } from "./PrefsProvider";

export type SimMode = "toMe" | "one" | "all";

export const SPEEDS = [
  { ms: 0, label: "Instant" },
  { ms: 700, label: "1 pick / 0.7s" },
  { ms: 1500, label: "1 pick / 1.5s" },
];

interface SimContextValue {
  running: SimMode | null;
  speed: number;
  setSpeed(ms: number): void;
  room: CpuStyle[];
  run(mode: SimMode): void;
  stop(): void;
}

const SimContext = createContext<SimContextValue>({
  running: null,
  speed: 0,
  setSpeed: () => {},
  room: [],
  run: () => {},
  stop: () => {},
});

export const useSim = () => useContext(SimContext);

/**
 * Mock-draft simulation for the live draft: CPU teams (and optionally the user) make picks,
 * instantly or one pick per tick. Ported from the prototype's simStep()/simRun()/simStopFn().
 */
export function SimProvider({ children }: { children: React.ReactNode }) {
  const { state, appendPicks } = useDraft();
  const { done, onClock, current, ctx, league } = useModel();
  const { prefs } = usePrefs();
  const toast = useToast();
  const { locked } = useEspnSync();
  const room = useMemo(() => roomFor(prefs.room, league.teams), [prefs.room, league.teams]);
  const [running, setRunning] = useState<SimMode | null>(null);
  const [speed, setSpeed] = useState(0);
  const firstTick = useRef(true);

  const continuation = useCallback(
    (picks: DraftPick[], autoMe: boolean) => simulateFrom(picks, room, ctx, { autoMe, rng: Math.random }).slice(picks.length),
    [room, ctx],
  );

  const stop = useCallback(() => setRunning(null), []);

  const run = useCallback(
    (mode: SimMode) => {
      if (locked) return toast("Mock picks are off while your ESPN draft is live");
      const picks = state.picks;
      const autoMe = mode === "all";
      if (speed > 0) {
        firstTick.current = true;
        setRunning(mode);
        return;
      }
      setRunning(null);
      if (mode === "one") {
        const [next] = continuation(picks, false);
        if (next) appendPicks([next]);
        else toast(done ? "Draft is complete" : "It's your pick");
        return;
      }
      const added = continuation(picks, autoMe);
      if (added.length) {
        appendPicks(added);
        toast(autoMe ? "Full mock complete — check your roster" : `Simmed picks ${picks.length + 1}–${picks.length + added.length}. You're on the clock.`);
      } else {
        toast(onClock ? "It's already your pick" : "Nothing to simulate");
      }
    },
    [state.picks, speed, continuation, appendPicks, toast, onClock, done, locked],
  );

  // ESPN live sync owns the board: going live cancels a timed run for good, so it can't resume into
  // the real draft if the sync later drops. (Adjusting state while rendering, not in an effect.)
  const [wasLocked, setWasLocked] = useState(locked);
  if (locked !== wasLocked) {
    setWasLocked(locked);
    if (locked && running) setRunning(null);
  }
  // Timed runs: one pick per tick, reading the latest picks each time.
  const ticking = locked ? null : running;
  useEffect(() => {
    const running = ticking;
    if (!running) return;
    const delay = firstTick.current ? 0 : speed;
    const timer = setTimeout(() => {
      firstTick.current = false;
      const [next] = continuation(state.picks, running === "all");
      if (!next) {
        setRunning(null);
        if (!done && onClock && running !== "one") toast(`Sim stopped: you're on the clock at pick ${current}`);
        return;
      }
      appendPicks([next]);
      if (running === "one") setRunning(null);
    }, delay);
    return () => clearTimeout(timer);
  }, [ticking, state.picks, speed, continuation, appendPicks, toast, done, onClock, current]);

  const value = useMemo(() => ({ running: ticking, speed, setSpeed, room, run, stop }), [ticking, speed, room, run, stop]);
  return <SimContext.Provider value={value}>{children}</SimContext.Provider>;
}

/** The mock-draft bar and room setup, shown when mock mode is on. Ported from the prototype's #simbar and #room. */
export function MockBar({ onReport, reportMocks }: { onReport(): void; reportMocks: number }) {
  const sim = useSim();
  const model = useModel();
  const { prefs, setPrefs } = usePrefs();
  const [roomOpen, setRoomOpen] = useState(false);
  const nonCasual = sim.room.filter((st) => st !== "casual").length;

  const setStyle = (i: number, style: CpuStyle) => {
    const next = sim.room.slice();
    next[i] = style;
    setPrefs({ room: next });
  };

  return (
    <>
      <div className={s.simbar}>
        <span className={s.simLabel}>MOCK</span>
        <button className={cx("btn", "go")} onClick={() => sim.run("toMe")}>
          Sim to my pick
        </button>
        <button className={s.btn} onClick={() => sim.run("one")}>
          Sim 1 pick
        </button>
        <button className={s.btn} onClick={() => sim.run("all")}>
          Sim full draft (auto-pick for me)
        </button>
        <select className={s.simSelect} value={sim.speed} onChange={(e) => sim.setSpeed(Number(e.target.value))} aria-label="Simulation speed">
          {SPEEDS.map((o) => (
            <option key={o.ms} value={o.ms}>
              {o.label}
            </option>
          ))}
        </select>
        {sim.running && (
          <button className={s.btn} onClick={sim.stop}>
            Stop
          </button>
        )}
        <span className={s.sep} />
        <button className={cx("btn", "go")} onClick={onReport}>
          Availability report
        </button>
        <span className={s.simTxt}>{reportMocks} mocks from the current pick, using this room</span>
        <span className={s.sep} />
        <button className={cx("btn", roomOpen && "on")} onClick={() => setRoomOpen((o) => !o)} aria-expanded={roomOpen}>
          Room setup
        </button>
        <span className={s.simTxt}>
          Room: {nonCasual} non-casual team{nonCasual === 1 ? "" : "s"}
        </span>
      </div>
      {roomOpen && (
        <div className={s.room}>
          <span>CPU teams by draft slot:</span>
          {sim.room.map((style, i) => (
            <label key={i}>
              <b>{slotForRoomIndex(i, model.league.mySlot)}</b>
              <select className={s.simSelect} value={style} onChange={(e) => setStyle(i, e.target.value as CpuStyle)}>
                {CPU_STYLES.map((k) => (
                  <option key={k} value={k}>
                    {STYLES[k].label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button className={s.btn} onClick={() => setPrefs({ room: null })} disabled={!prefs.room || prefs.room.join() === defaultRoom(model.league.teams).join()}>
            Reset room
          </button>
        </div>
      )}
    </>
  );
}
