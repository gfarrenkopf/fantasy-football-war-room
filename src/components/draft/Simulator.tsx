"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CPU_STYLES, defaultRoom, roomFor, simulateFrom, slotForRoomIndex, STYLES } from "@/lib/draft/sim";
import type { CpuStyle, DraftPick } from "@/lib/draft/types";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { useDraft } from "./DraftProvider";
import { useEspnSync } from "./EspnSync";
import { useToast } from "./Feedback";
import { DraftMenu, SimAllIcon, SimOneIcon, SimToMeIcon, StopIcon, type DraftTool } from "./Header";
import { usePrefs } from "./PrefsProvider";

export type SimMode = "toMe" | "one" | "all";

export const SPEEDS = [
  { ms: 0, label: "Instant" },
  { ms: 700, label: "0.7s" },
  { ms: 1500, label: "1.5s" },
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

/**
 * The mock draft's sims (APE-322), folded into the control bar: a slim group of icon buttons beside
 * the status chip on a wide screen, one Sim menu in the phone's bottom bar. Speed, the availability
 * report and room setup wait in the draft tools menu. Ported from the prototype's #simbar.
 */
export function MockControls({ menu }: { menu: boolean }) {
  const sim = useSim();
  if (menu) {
    const items: DraftTool[] = [
      { label: "Sim to my pick", onSelect: () => sim.run("toMe") },
      { label: "Sim 1 pick", onSelect: () => sim.run("one") },
      { label: "Sim full draft (auto-picks for you)", onSelect: () => sim.run("all") },
      ...(sim.running ? [{ label: "Stop", onSelect: sim.stop }] : []),
    ];
    return <DraftMenu label="Mock draft sims" items={items} icon={sim.running ? <StopIcon /> : <SimOneIcon />} className={cx("simBtn", sim.running && "on")} iconOnly />;
  }
  return (
    <div className={s.simGroup} role="group" aria-label="Mock draft">
      <span className={s.simLabel}>Mock</span>
      <button className={cx("btn", "go")} onClick={() => sim.run("toMe")} title="Sim every pick up to your next turn" aria-label="Sim to my pick">
        <SimToMeIcon />
        <span className={s.simText}>To me</span>
      </button>
      <button className={s.btn} onClick={() => sim.run("one")} title="Sim the next pick" aria-label="Sim 1 pick">
        <SimOneIcon />
        <span className={s.simText}>1 pick</span>
      </button>
      <button className={s.btn} onClick={() => sim.run("all")} title="Sim the full draft, auto-picking for you" aria-label="Sim the full draft">
        <SimAllIcon />
        <span className={s.simText}>All</span>
      </button>
      {sim.running && (
        <button className={s.btn} onClick={sim.stop} title="Stop the sim" aria-label="Stop the sim">
          <StopIcon />
          <span className={s.simText}>Stop</span>
        </button>
      )}
    </div>
  );
}

/** The mock room's CPU teams by draft slot, under the bar while it's open from the draft tools. Ported from the prototype's #room. */
export function MockRoom() {
  const sim = useSim();
  const model = useModel();
  const { prefs, setPrefs } = usePrefs();

  const setStyle = (i: number, style: CpuStyle) => {
    const next = sim.room.slice();
    next[i] = style;
    setPrefs({ room: next });
  };

  return (
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
  );
}
