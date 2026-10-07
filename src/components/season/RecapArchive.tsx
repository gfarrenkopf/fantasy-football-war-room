"use client";

import { useId, useState } from "react";
import { stage } from "@/components/draft/stageFont";
import type { ArchiveWeek, RecapPlayer } from "@/lib/season/leagueRecap";
import { posLabel, pts, signed } from "./parts";
import s from "./season.module.css";
import { WeekSwing } from "./WeekSwing";

/**
 * The recap archive (APE-250): every kept week of the league, told after ESPN's matchup recap. A row
 * of week chips picks the week, newest first selected; the user's result and its write-up lead, how
 * it swung follows, and the league's week sits beside it: standings, top scorers, the game changer,
 * the most valuable benchwarmers and the false starters. A season menu appears only once there's a
 * second season to pick.
 */
export function RecapArchive({ weeks }: { weeks: ArchiveWeek[] }) {
  const seasons = [...new Set(weeks.map((w) => w.season))].sort((a, b) => b - a);
  const [season, setSeason] = useState(seasons[0]);
  const inSeason = weeks.filter((w) => w.season === season).sort((a, b) => a.week - b.week);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = inSeason.find((w) => w.week === picked) ?? inSeason.at(-1);
  const titleId = useId();
  if (!shown) return null;
  const { recap, swing } = shown;
  const mine = recap.mine;

  return (
    <section className={s.archive} aria-labelledby={titleId}>
      <div className={s.archiveHead}>
        <h2 id={titleId} className={s.archiveTitle}>
          Recaps
        </h2>
        {seasons.length > 1 && (
          <select
            className={s.archiveSeason}
            aria-label="Season"
            value={season}
            onChange={(e) => {
              setSeason(Number(e.target.value));
              setPicked(null);
            }}
          >
            {seasons.map((y) => (
              <option key={y} value={y}>
                {y} season
              </option>
            ))}
          </select>
        )}
        <div className={s.weekChips} role="group" aria-label="Week">
          {inSeason.map((w) => (
            <button
              key={w.week}
              type="button"
              className={s.weekChip}
              data-result={w.recap.mine?.result ?? "bye"}
              aria-pressed={w.week === shown.week}
              aria-label={`Week ${w.week}${w.recap.mine ? `, ${w.recap.mine.result === "win" ? "won" : w.recap.mine.result === "loss" ? "lost" : "tied"}` : ""}`}
              onClick={() => setPicked(w.week)}
            >
              W{w.week}
            </button>
          ))}
        </div>
      </div>

      {/* Two balanced columns on a desktop; one column in the reading order below that (data-order). */}
      <div className={`${s.lineup} ${s.archiveBody}`}>
        <div className={s.stack}>
          <article className={`${s.panel} ${s.recapHero} ${stage.variable}`} data-order="1" data-result={mine?.result ?? "bye"}>
            <span className={s.recapNumeral} aria-hidden>
              {recap.week}
            </span>
            <p className={s.momentWeek}>Week {recap.week} · Final</p>
            {mine ? (
              <>
                <h3 className={s.recapResult}>{mine.result === "win" ? "Won" : mine.result === "loss" ? "Lost" : "Tied"}</h3>
                <p className={s.recapScore}>
                  <b className="tabular-nums">{pts(mine.me)}</b>
                  <span className={s.momentDash}>–</span>
                  <span className="tabular-nums">{pts(mine.them)}</span>
                  <span className={s.recapOpponent}>vs {mine.opponent}</span>
                </p>
                <p className={s.recapStory}>{recap.story}</p>
              </>
            ) : (
              <h3 className={s.recapResult}>Bye week</h3>
            )}
          </article>
          {mine && swing && (
            <div className={s.panel} data-order="2">
              <WeekSwing swing={swing} result={mine.result} />
            </div>
          )}
          {recap.gameChanger && (
            <section className={s.panel} aria-label="Game changer" data-order="5">
              <div className={s.panelHead}>
                <h3 className={s.panelTitle}>Game changer</h3>
                <span className={s.panelNote}>Decided a matchup</span>
              </div>
              <div className={s.changerBody}>
                <p className={s.changerName}>
                  {recap.gameChanger.player.name}
                  <span className={s.recapSub}>
                    {posLabel(recap.gameChanger.player.pos)} · {recap.gameChanger.player.teamName}
                  </span>
                </p>
                <p className={s.changerPoints}>
                  <b className="tabular-nums">{pts(recap.gameChanger.player.points)}</b>
                  <span className={s.callGap} data-sign="over">
                    {signed(recap.gameChanger.player.gap)}
                  </span>
                </p>
                <p className={`${s.fine} ${s.changerLine}`}>
                  Won <span className="tabular-nums">{pts(recap.gameChanger.score.his)}</span>–
                  <span className="tabular-nums">{pts(recap.gameChanger.score.theirs)}</span> against {recap.gameChanger.opponent}: by less than his{" "}
                  <span className="tabular-nums">{pts(recap.gameChanger.player.gap)}</span> over ESPN&apos;s call.
                </p>
              </div>
            </section>
          )}

          {recap.falseStarters.length > 0 && (
            <RecapPanel title="False starters" note="Should have sat" order={7}>
              {recap.falseStarters.map((p) => (
                <PlayerRow key={p.playerId} player={p} gap />
              ))}
            </RecapPanel>
          )}
        </div>

        <div className={s.stack}>
          <RecapPanel title="Standings" note={`After week ${recap.week}`} order={3}>
            {recap.standings.map((t) => (
              <li key={t.teamId} className={s.recapRow} data-mine={t.mine}>
                <span className={s.recapRank}>{t.rank}</span>
                <span className={s.recapName}>{t.name}</span>
                <span className={`${s.recapValue} tabular-nums`}>
                  {t.wins}–{t.losses}
                  {t.ties ? `–${t.ties}` : ""}
                </span>
              </li>
            ))}
          </RecapPanel>

          <RecapPanel title="Top scorers" order={4}>
            {recap.topScorers.map((p, i) => (
              <PlayerRow key={p.playerId} player={p} rank={i + 1} />
            ))}
          </RecapPanel>

          {recap.benchwarmers.length > 0 && (
            <RecapPanel title="Most valuable benchwarmers" note="Points left on the bench" order={6}>
              {recap.benchwarmers.map((p) => (
                <PlayerRow key={p.playerId} player={p} />
              ))}
            </RecapPanel>
          )}
        </div>
      </div>
    </section>
  );
}

function RecapPanel({ title, note, order, children }: { title: string; note?: string; order: number; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className={s.panel} aria-labelledby={id} data-order={order}>
      <div className={s.panelHead}>
        <h3 id={id} className={s.panelTitle}>
          {title}
        </h3>
        {note && <span className={s.panelNote}>{note}</span>}
      </div>
      <ol className={s.recapList}>{children}</ol>
    </section>
  );
}

/** A player in a recap list: his name over his position and fantasy team, his points on the right, and with `gap` how far under ESPN's call. */
function PlayerRow({ player, rank, gap }: { player: RecapPlayer; rank?: number; gap?: boolean }) {
  return (
    <li className={s.recapRow}>
      <span className={s.recapRank}>{rank ?? posLabel(player.pos)}</span>
      <span className={s.recapName}>
        {player.name}
        <span className={s.recapSub}>{rank !== undefined ? `${posLabel(player.pos)} · ${player.teamName}` : player.teamName}</span>
      </span>
      <span className={`${s.recapValue} tabular-nums`}>
        {pts(player.points)}
        {gap && (
          <span className={s.callGap} data-sign="under">
            {signed(player.gap)}
          </span>
        )}
      </span>
    </li>
  );
}
