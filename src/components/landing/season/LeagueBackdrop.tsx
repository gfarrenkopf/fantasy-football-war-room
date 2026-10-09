import type { SeasonSample } from "@/lib/landing/seasonSample";
import { cx } from "./cx";

/** How many matchup tiles the backdrop deals: enough to fill a tall, wide screen. */
const TILES = 84;

/**
 * The season hero's ground: the rest of the league's week, matchup by matchup, at the season page's
 * own density, the way the draft hero runs a board behind its panel. It's set dressing, so it's
 * aria-hidden and still: the one thing moving on this hero is the visitor's own lineup.
 */
export function LeagueBackdrop({ sample }: { sample: SeasonSample }) {
  const games = sample.scoreboard;
  const tiles = Array.from({ length: TILES }, (_, i) => {
    // Shift a game each pass, so a column doesn't repeat one matchup all the way down.
    const g = games[(i + Math.floor(i / 7)) % games.length];
    // Each pass round the league is a different week: nudge the scores so the repeats don't read as copies.
    const lap = Math.floor(i / games.length);
    const nudge = (n: number, k: number) => Math.round((n + ((lap * 7.3 + k * 3.1) % 19) - 9) * 10) / 10;
    return { ...g, homeScore: nudge(g.homeScore, i), awayScore: nudge(g.awayScore, i + 2) };
  });

  return (
    <div className={cx("backdrop")} aria-hidden="true">
      {tiles.map((t, i) => {
        const homeWins = t.homeScore >= t.awayScore;
        return (
          <div key={i} className={cx("tile")} style={{ animationDelay: `${Math.min(i * 22, 620)}ms` }}>
            <div className={cx("tileRow", homeWins && "tileLead")}>
              <span>{t.home}</span>
              <b>{t.homeScore.toFixed(1)}</b>
            </div>
            <div className={cx("tileRow", !homeWins && "tileLead")}>
              <span>{t.away}</span>
              <b>{t.awayScore.toFixed(1)}</b>
            </div>
            <div className={cx("tileBar")}>
              <span style={{ width: `${Math.round((t.homeScore / (t.homeScore + t.awayScore)) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
