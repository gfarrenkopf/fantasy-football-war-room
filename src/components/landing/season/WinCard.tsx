import { stage } from "@/components/draft/stageFont";
import { callsWorth, type SeasonSample } from "@/lib/landing/seasonSample";
import { cx } from "./cx";

/**
 * The season hero's second object, beside the entry panel: the week already won, and why. YOU WON
 * and the final in Win Night's stage face, then Draft Room's calls as the receipt: the player it
 * started, what he scored, and the starter he replaced with what that one scored. The footer does
 * the math the visitor would: what the calls were worth, and that set by rank, the week was a loss.
 *
 * It lands once (the card rises, YOU WON slams, the calls follow) and then holds still. Every word
 * is real text, so it reads the same without the motion.
 */

const one = (n: number) => n.toFixed(1);
const CALLS: Record<number, string> = { 1: "one call", 2: "two calls", 3: "three calls" };
const POS_CLASS: Record<string, string> = { QB: "qb", RB: "rb", WR: "wr", TE: "te", K: "k", DST: "dst" };

export function WinCard({ sample }: { sample: SeasonSample }) {
  const { you, opponent } = sample.final;
  const worth = callsWorth(sample.swaps);
  const byRank = you - worth;

  return (
    <article className={cx("win")} aria-label="A week with Draft Room">
      <header className={cx("winHead")}>
        <div className={`${cx("winWord")} ${stage.variable}`}>You won</div>
        <div className={cx("winScore")}>
          <b>{one(you)}</b>
          <span>–</span>
          {one(opponent)}
        </div>
        <p className={cx("winTeams")}>
          {sample.you} vs {sample.opponent}
        </p>
      </header>

      <h2 className={cx("callsLabel")}>Draft Room&apos;s calls</h2>
      <ol className={cx("calls")}>
        {sample.swaps.map((sw, i) => (
          <li key={sw.in.name} className={cx("call")} style={{ animationDelay: `${620 + i * 160}ms` }}>
            <span className={cx("slot", POS_CLASS[sw.in.pos])}>{sample.lineup[sw.slot].slot}</span>
            <span className={cx("callWho")}>
              <span className={cx("callIn")}>
                Started <b>{sw.in.name}</b>
              </span>
              <span className={cx("callOut")}>
                over {sw.out.name}, who scored <b>{one(sw.points.out)}</b>
              </span>
            </span>
            <span className={cx("callPts")}>
              <b>{one(sw.points.in)}</b>
              <span>pts</span>
            </span>
          </li>
        ))}
      </ol>

      <footer className={cx("winFoot")}>
        <b className={cx("winWorth")}>+{one(worth)}</b>
        <p>
          points from {CALLS[sample.swaps.length] ?? `${sample.swaps.length} calls`}. Won by {one(you - opponent)}.
          <br />
          <span>
            Set by rank, you lose {one(byRank)} to {one(opponent)}.
          </span>
        </p>
      </footer>
    </article>
  );
}
