import type { CSSProperties } from "react";
import type { WeekSwing as Swing } from "@/lib/season/swing";
import { pts, signed } from "./parts";
import s from "./season.module.css";

/**
 * Why the week went the way it did (APE-243), told on the result card: the lead ESPN projected for
 * the user before kickoff, then each player who moved it, as a bar from the lead before him to the
 * lead after, until the final. The bars share one scale with a hairline at zero, so the bar crossing
 * it is where the week turned. Every number is said in words too (APE-245): a lead reads "Up 27.8",
 * a player says whose he was and what he scored against his projection.
 */
export function WeekSwing({ swing, result }: { swing: Swing; result: "win" | "loss" | "tie" }) {
  const steps = [
    ...swing.swings.map((w) => ({
      key: `p${w.playerId}`,
      label: w.name,
      sub: `${w.side === "them" ? "Their" : "Your"} ${w.pos === "DST" ? "D/ST" : w.pos} · ${pts(w.points)}, projected ${pts(w.projected)}`,
      delta: w.delta,
      before: w.before,
      after: w.after,
    })),
    ...(swing.rest ? [{ key: "rest", label: "Everyone else", sub: "Every other starter, both teams", ...swing.rest }] : []),
  ];
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
          {result === "win" ? "Why you won" : result === "loss" ? "Why you lost" : "Why it ended level"}
        </h3>
        <span className={s.swingNote}>Your lead, kickoff to final</span>
      </div>
      <p className={s.swingVerdict}>{verdict(swing, result)}</p>
      <ol className={s.swingTrack} style={track}>
        <li className={s.swingRow} data-kind="mark">
          <span className={s.swingLabel}>
            <span className={s.swingName}>Before kickoff</span>
            <span className={s.swingFacts}>ESPN&apos;s projection</span>
          </span>
          <span className={s.swingBar}>
            <span className={s.swingDot} style={{ left: at(swing.projected) }} />
          </span>
          <span className={`${s.swingValue} tabular-nums`}>{lead(swing.projected)}</span>
        </li>
        {steps.map((w, i) => (
          <li key={w.key} className={s.swingRow} data-tone={w.delta >= 0 ? "up" : "down"} style={{ "--i": i } as CSSProperties}>
            <span className={s.swingLabel}>
              <span className={s.swingName}>{w.label}</span>
              <span className={`${s.swingFacts} tabular-nums`}>{w.sub}</span>
            </span>
            <span className={s.swingBar}>
              <span className={s.swingFill} style={{ left: at(Math.min(w.before, w.after)), width: `${(Math.abs(w.after - w.before) / span) * 100}%` }} />
            </span>
            <span className={`${s.swingValue} tabular-nums`}>
              <span className={s.swingDelta}>
                <span className="sr-only">{w.delta >= 0 ? "Helped you by " : "Cost you "}</span>
                <span aria-hidden>{signed(w.delta)}</span>
                <span className="sr-only">{pts(Math.abs(w.delta))}, leaving you </span>
              </span>
              <span className={s.swingRun}>{lead(w.after)}</span>
            </span>
          </li>
        ))}
        <li className={s.swingRow} data-kind="final">
          <span className={s.swingLabel}>
            <span className={s.swingName}>Final</span>
          </span>
          <span className={s.swingBar}>
            <span className={s.swingDot} style={{ left: at(swing.final) }} />
          </span>
          <span className={`${s.swingValue} tabular-nums`}>{result === "win" ? `Won by ${pts(swing.final)}` : result === "loss" ? `Lost by ${pts(-swing.final)}` : "Tied"}</span>
        </li>
      </ol>
      {swing.empty.length > 0 && (
        <p className={s.swingBench}>
          <b>{list(swing.empty)}</b> started but {swing.empty.length === 1 ? "was" : "were"} projected 0 and scored 0.
        </p>
      )}
      {swing.hindsight?.best && (swing.hindsight.wouldHaveWon || swing.hindsight.gain >= 5) && (
        <p className={s.swingBench}>
          {swing.hindsight.wouldHaveWon ? (
            <>
              Your best possible lineup would have won, with <b className="tabular-nums">{pts(swing.hindsight.total)}</b>.
            </>
          ) : (
            <>
              Your best possible lineup would have scored <b className="tabular-nums">{pts(swing.hindsight.gain)}</b> more.
            </>
          )}{" "}
          {swing.hindsight.best.name} scored <b className="tabular-nums">{pts(swing.hindsight.best.points)}</b> on your bench.
        </p>
      )}
    </section>
  );
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** A margin as the user's lead: "Up 27.8", "Down 12.0", or "Even". */
const lead = (n: number) => (n > 0 ? `Up ${pts(n)}` : n < 0 ? `Down ${pts(-n)}` : "Even");

/** The whole story in words: what ESPN projected, how it ended, and how each side scored against its projections. */
function verdict(swing: Swing, result: "win" | "loss" | "tie"): string {
  const p = swing.projected;
  const call = p > 0 ? `ESPN projected you to win by ${pts(p)}.` : p < 0 ? `ESPN projected you to lose by ${pts(-p)}.` : "ESPN projected a dead heat.";
  const end = result === "win" ? `You won by ${pts(swing.final)}` : result === "loss" ? `You lost by ${pts(-swing.final)}` : "It ended level";
  const side = (n: number) => `${pts(Math.abs(n))} ${n >= 0 ? "more" : "fewer"}`;
  return `${call} ${end}: your starters scored ${side(swing.mine)} points than projected, and theirs scored ${side(swing.theirs)}.`;
}
