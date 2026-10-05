import type { CSSProperties } from "react";
import type { WeekSwing as Swing } from "@/lib/season/swing";
import { pts, signed } from "./parts";
import s from "./season.module.css";

/**
 * How the week swung (APE-243), told on the result card: ESPN's margin before kickoff, then each
 * player who moved it, as a bar from where the margin was to where he left it, until the final. The
 * bars share one scale with a hairline at zero, so the line crossing from your side to theirs (or
 * back) is the moment the week turned. They draw in order, once, as the card arrives.
 */
export function WeekSwing({ swing, result }: { swing: Swing; result: "win" | "loss" | "tie" }) {
  const steps = [...swing.swings.map((w) => ({ key: `p${w.playerId}`, label: w.name, theirs: w.side === "them", ...w })), ...(swing.rest ? [{ key: "rest", label: "Everyone else", theirs: false, ...swing.rest }] : [])];
  if (!steps.length) return null;

  const ends = [0, swing.projected, swing.final, ...steps.flatMap((w) => [w.before, w.after])];
  const lo = Math.min(...ends);
  const span = Math.max(...ends) - lo || 1;
  const at = (n: number) => `${((n - lo) / span) * 100}%`;
  const track = { "--zero": at(0) } as CSSProperties;

  return (
    <section className={s.swing} aria-labelledby="swing-title">
      <div className={s.swingHead}>
        <h3 id="swing-title" className={s.swingTitle}>
          How it swung
        </h3>
        <span className={s.swingNote}>Your margin</span>
      </div>
      <p className={s.swingVerdict}>{verdict(swing, result)}</p>
      <ol className={s.swingTrack} style={track}>
        <li className={s.swingRow} data-kind="mark">
          <span className={s.swingLabel}>
            <span className={s.swingName}>ESPN&apos;s call</span>
          </span>
          <span className={s.swingBar}>
            <span className={s.swingDot} style={{ left: at(swing.projected) }} />
          </span>
          <span className={`${s.swingValue} tabular-nums`}>{signed(swing.projected)}</span>
        </li>
        {steps.map((w, i) => (
          <li key={w.key} className={s.swingRow} data-tone={w.delta >= 0 ? "up" : "down"} style={{ "--i": i } as CSSProperties}>
            <span className={s.swingLabel}>
              <span className={s.swingName}>{w.label}</span>
              {"points" in w && (
                <span className={`${s.swingFacts} tabular-nums`}>
                  {w.theirs && "Theirs · "}
                  {pts(w.points)} on {pts(w.projected)}
                </span>
              )}
            </span>
            <span className={s.swingBar}>
              <span className={s.swingFill} style={{ left: at(Math.min(w.before, w.after)), width: `${(Math.abs(w.after - w.before) / span) * 100}%` }} />
            </span>
            <span className={`${s.swingValue} ${s.swingDelta} tabular-nums`}>{signed(w.delta)}</span>
          </li>
        ))}
        <li className={s.swingRow} data-kind="final">
          <span className={s.swingLabel}>
            <span className={s.swingName}>Final</span>
          </span>
          <span className={s.swingBar}>
            <span className={s.swingDot} style={{ left: at(swing.final) }} />
          </span>
          <span className={`${s.swingValue} tabular-nums`}>{signed(swing.final)}</span>
        </li>
      </ol>
      {swing.empty.length > 0 && (
        <p className={s.swingBench}>
          <b>{list(swing.empty)}</b> started, projected for nothing, and scored nothing.
        </p>
      )}
      {swing.hindsight?.best && (swing.hindsight.wouldHaveWon || swing.hindsight.gain >= 5) && (
        <p className={s.swingBench}>
          {swing.hindsight.wouldHaveWon ? (
            <>
              Your best lineup would have won, with <b className="tabular-nums">{pts(swing.hindsight.total)}</b>. {swing.hindsight.best.name} scored{" "}
              <b className="tabular-nums">{pts(swing.hindsight.best.points)}</b> on your bench.
            </>
          ) : (
            <>
              <b className="tabular-nums">{pts(swing.hindsight.gain)}</b> more points sat on your bench, {swing.hindsight.best.name}&apos;s{" "}
              <b className="tabular-nums">{pts(swing.hindsight.best.points)}</b> the most.
            </>
          )}
        </p>
      )}
    </section>
  );
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The week in a sentence or two: an upset or a slip first, then how each side did against ESPN's call. */
function verdict(swing: Swing, result: "win" | "loss" | "tie"): string {
  const turned =
    result === "win" && swing.projected < 0
      ? `ESPN had you down ${pts(-swing.projected)}, and you won anyway. `
      : result === "loss" && swing.projected > 0
        ? `ESPN had you up ${pts(swing.projected)}, and it got away. `
        : "";
  const yours = swing.mine >= 0 ? `Your starters beat ESPN's call by ${pts(swing.mine)}` : `Your starters came in ${pts(-swing.mine)} under ESPN's call`;
  const theirs = swing.theirs >= 0 ? `theirs beat it by ${pts(swing.theirs)}` : `theirs came in ${pts(-swing.theirs)} under`;
  return `${turned}${yours}; ${theirs}.`;
}
