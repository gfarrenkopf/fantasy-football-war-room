"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ByeConflict } from "@/lib/draft/roster";
import { formatRoundPick } from "@/lib/draft/snake";
import type { Player } from "@/lib/draft/types";
import { valueTagLabel, type ValueTag } from "@/lib/draft/value";
import { POS_COLOR } from "./Board";
import { cx, s } from "./cx";
import { posLabel } from "./PlayerCard";

/** Everything the pick card says about a pick the user just made by hand. */
export interface PickMoment {
  player: Player;
  /** Overall pick number. */
  pickNo: number;
  teams: number;
  /** Roster slot the player landed in ("WR2", "FLEX", "Bench"), or null past the last slot. */
  slot: string | null;
  tag: ValueTag;
  clash: ByeConflict | null;
  /** The user's next pick after this one; greater than `total` when this was the last. */
  next: number;
  total: number;
}

/** How long the card stays: long enough to read, never long enough to sit over the next pick. */
const lifeFor = (m: PickMoment) => (m.clash ? 4200 : m.next === m.pickNo + 1 ? 1800 : 2600);

const CelebrateContext = createContext<(m: PickMoment) => void>(() => {});

/** Shows the pick card for the user's own picks, the way ToastProvider shows toasts. */
export function PickCelebrationProvider({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState<(PickMoment & { id: number; leaving: boolean }) | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const seq = useRef(0);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const dismiss = useCallback(() => {
    clear();
    setShown((m) => (m ? { ...m, leaving: true } : m));
    timers.current.push(setTimeout(() => setShown(null), 180));
  }, []);

  const celebrate = useCallback(
    (m: PickMoment) => {
      clear();
      setShown({ ...m, id: ++seq.current, leaving: false });
      timers.current.push(setTimeout(dismiss, lifeFor(m)));
      // A short double tap on phones that support it (Android); iOS ignores vibrate().
      navigator.vibrate?.([18, 50, 28]);
    },
    [dismiss],
  );

  useEffect(() => clear, []);

  return (
    <CelebrateContext.Provider value={celebrate}>
      {children}
      {shown && <PickCard key={shown.id} m={shown} life={lifeFor(shown)} leaving={shown.leaving} onDismiss={dismiss} />}
    </CelebrateContext.Provider>
  );
}

export const useCelebrate = () => useContext(CelebrateContext);

function PickCard({ m, life, leaving, onDismiss }: { m: PickMoment; life: number; leaving: boolean; onDismiss(): void }) {
  const { player: p, pickNo, slot, tag, clash, next, total } = m;
  const again = next === pickNo + 1;
  const verdict = tag.kind === "value" || tag.kind === "reach";
  return (
    <div
      className={cx("pickCard", leaving && "leaving", !!clash && "warned")}
      style={{ "--pos": POS_COLOR[p.pos], "--life": `${life}ms` } as React.CSSProperties}
      role="status"
      aria-live="polite"
      onClick={onDismiss}
      title="Tap to dismiss"
    >
      <div className={s.pcHead}>
        <span className={s.pcCheck} aria-hidden="true">
          ✓
        </span>
        <div className={s.pcWho}>
          <b className={s.pcName}>{p.name}</b>
          <span className={s.pcMeta}>
            <i>{posLabel(p.pos)}</i>
            {p.team} · {posLabel(p.pos)} {p.posRank} · bye {p.bye}
          </span>
        </div>
        <div className={s.pcPick}>
          <b>#{pickNo}</b>
          <span>rd {formatRoundPick(pickNo, m.teams)}</span>
        </div>
      </div>
      {(slot || verdict) && (
        <div className={s.pcFacts}>
          {slot && (
            <span>
              {slot === "Bench" ? "Goes to the " : "Starts at "}
              <b>{slot === "Bench" ? "bench" : slot}</b>
            </span>
          )}
          {verdict && <span className={cx("tag", tag.kind)}>{valueTagLabel(tag)}</span>}
        </div>
      )}
      {clash && (
        <div className={s.pcWarn}>
          ⚠ Week {p.bye}: {clash.n} starters out, with {clash.who.join(", ")}
        </div>
      )}
      <div className={cx("pcNext", again && "again")}>
        {again ? `You're still up: pick ${next}` : next <= total ? `Next turn: pick ${next}, ${next - pickNo} picks away` : "That was your last pick."}
      </div>
      <i className={s.pcLife} aria-hidden="true" />
    </div>
  );
}
