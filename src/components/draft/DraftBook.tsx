"use client";

import { useEffect, useMemo, useState } from "react";
import { draftRecap, type RecapPick } from "@/lib/draft/recap";
import { byeWeekList } from "@/lib/draft/roster";
import { roundOf, roundsOf } from "@/lib/draft/snake";
import { draftWrap, type WrapPick } from "@/lib/draft/wrap";
import { POS_COLOR } from "./Board";
import { cx, s } from "./cx";
import { useDraft } from "./DraftProvider";
import { useModel } from "./DraftModel";
import { useLeague } from "./LeagueProvider";
import { ordinal, stage } from "./OpeningNight";
import { posLabel } from "./PlayerCard";
import { useHasSeasonPage } from "./SeasonLinks";

/**
 * The finished draft at rest (APE-225): what the room shows once every pick is in, in place of the
 * live room's empty plan and pick log. The finale's voice without its show: the lineup the user
 * drafted, a few lines on who got the best of the draft and who reached, and every pick a click
 * away. A league that follows ESPN names its teams and opens onto this week's lineup.
 */
export function DraftBook() {
  const model = useModel();
  const { state } = useDraft();
  const { active } = useLeague();
  const { league, dataset } = model;
  const linked = useHasSeasonPage(active?.id);
  const names = useDraftTeamNames(linked ? (active?.id ?? null) : null);

  const wrap = useMemo(() => draftWrap(model.slots, league.teams, byeWeekList(dataset.byeWeeks)), [model.slots, league.teams, dataset.byeWeeks]);
  const recap = useMemo(() => draftRecap(state.picks, (id) => model.ctx.byId.get(id), league), [state.picks, model.ctx, league]);
  const teamName = (slot: number) => (slot === league.mySlot ? "You" : (names?.[slot - 1] ?? `Team ${slot}`));

  const steal = recap.mine.steal;
  const best = wrap.best;
  const { reach: myReach } = recap.mine;
  const { steal: theirSteal, reach: theirReach } = recap.league;
  const sharpest = recap.sharpest;
  const season = active?.season ?? dataset.season;

  return (
    <div className={`${s.book} ${stage.variable}`}>
      <div className={s.bookInner}>
        <header className={s.bookHead}>
          <div>
            <p className={s.bookKicker}>The {season} Draft</p>
            <h2 className={s.bookTitle}>In the books</h2>
            <p className={s.bookMeta}>
              {active?.name ?? "Your league"} · {league.teams} teams · {roundsOf(league)} rounds
            </p>
          </div>
          {linked && active && (
            <a className={cx("btn", "seasonDoor", "bookDoor")} href={`/season/${active.id}`}>
              <span className={s.doorMark} aria-hidden />
              This week&apos;s lineup
            </a>
          )}
        </header>

        <div className={s.bookBody}>
          <section className={s.bookLineup} aria-labelledby="book-lineup">
            <h3 id="book-lineup" className={s.bookLabel}>
              Your drafted lineup
            </h3>
            <ol className={s.bookCards}>
              {wrap.starters.map((p) => (
                <LineupRow key={p.player.id} p={p} star={steal?.player?.id === p.player.id} />
              ))}
            </ol>
            {wrap.bench.length > 0 && <Bench bench={wrap.bench} star={steal?.player?.id ?? null} />}
            <ul className={s.bookReport} aria-label="Report card">
              <li>
                <b>
                  {wrap.beat.k} of {wrap.beat.n}
                </b>{" "}
                picks came after the experts&apos; rank
              </li>
              <li className={cx(wrap.stacked.length > 0 && "warn")}>
                {wrap.stacked.length ? wrap.stacked.map((w) => `Week ${w.week}: ${w.n} starters out`).join(" · ") : "No stacked bye weeks among your starters"}
              </li>
            </ul>
          </section>

          <section className={s.bookNotes} aria-label="The book on this draft">
            {(steal ?? best) && (
              <Note tone="mine" label={steal ? "Your steal" : "Your best pick"} pos={(steal?.player ?? best!.player).pos}>
                <b className={s.noteName}>{(steal?.player ?? best!.player).name}</b>
                {steal ? (
                  <>
                    Experts ranked him <b>{ordinal(steal.player!.consensusRank)}</b>. You got him <b>{ordinal(steal.n)}</b>, at {steal.roundPick}.
                  </>
                ) : (
                  <>
                    The best-ranked player on your team: <b>{ordinal(best!.player.consensusRank)}</b> by consensus.
                  </>
                )}
              </Note>
            )}
            {myReach && (
              <Note tone="reach" label="Your reach" pos={myReach.player!.pos}>
                <b className={s.noteName}>{myReach.player!.name}</b>
                You took him at {myReach.roundPick}, <b>{-myReach.gain!} picks</b> before the experts would have.
              </Note>
            )}
            {theirSteal && !theirSteal.mine && (
              <Note tone="league" label="Steal of the draft" pos={theirSteal.player!.pos}>
                <b className={s.noteName}>{theirSteal.player!.name}</b>
                <b>{teamName(theirSteal.slot)}</b> got him at {theirSteal.roundPick}, <b>{theirSteal.gain} picks</b> after the experts&apos; rank.
              </Note>
            )}
            {theirReach && !theirReach.mine && (
              <Note tone="league" label="Biggest reach" pos={theirReach.player!.pos}>
                <b className={s.noteName}>{theirReach.player!.name}</b>
                <b>{teamName(theirReach.slot)}</b> took him at {theirReach.roundPick}, <b>{-theirReach.gain!} picks</b> early.
              </Note>
            )}
            {sharpest && (
              <p className={s.noteLine}>
                {sharpest.slot === league.mySlot ? (
                  <>
                    <b>You</b> drafted the sharpest:
                  </>
                ) : (
                  <>
                    Sharpest drafter: <b>{teamName(sharpest.slot)}</b>,
                  </>
                )}{" "}
                {sharpest.k} of {sharpest.n} picks after the experts&apos; rank.
              </p>
            )}
          </section>
        </div>

        <EveryPick picks={recap.picks} teams={league.teams} threshold={league.valueThreshold} teamName={teamName} />
      </div>
    </div>
  );
}

function LineupRow({ p, star }: { p: WrapPick; star: boolean }) {
  const gain = p.gain;
  return (
    <li className={cx("bookCard", star && "star")} style={{ "--pos": POS_COLOR[p.player.pos] } as React.CSSProperties}>
      <span className={s.fnSlot}>{p.slot === "Bench" ? "BN" : p.slot}</span>
      <span className={s.fnWho}>
        <b>{p.player.name}</b>
        <small>
          {posLabel(p.player.pos)} · {p.player.team} · {p.roundPick}
        </small>
      </span>
      <span className={cx("bookDelta", gain === null ? "na" : gain > 0 ? "up" : gain < 0 && "down")} title="Picks after the experts' rank">
        {gain === null ? "—" : gain > 0 ? `+${gain}` : gain < 0 ? `−${-gain}` : "0"}
      </span>
    </li>
  );
}

function Bench({ bench, star }: { bench: WrapPick[]; star: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={s.bookMore} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={s.chev} />
        {open ? "Hide the bench" : `+ ${bench.length} on the bench`}
      </button>
      {open && (
        <ol className={cx("bookCards", "bookBench")}>
          {bench.map((p) => (
            <LineupRow key={p.player.id} p={p} star={star === p.player.id} />
          ))}
        </ol>
      )}
    </>
  );
}

function Note({ tone, label, pos, children }: { tone: "mine" | "reach" | "league"; label: string; pos: keyof typeof POS_COLOR; children: React.ReactNode }) {
  return (
    <div className={s.bookNote} data-tone={tone} style={{ "--pos": POS_COLOR[pos] } as React.CSSProperties}>
      <p className={s.noteSlab}>{label}</p>
      <p className={s.noteStory}>{children}</p>
    </div>
  );
}

/** Every pick of the draft, round by round: closed until asked for. */
function EveryPick({ picks, teams, threshold, teamName }: { picks: RecapPick[]; teams: number; threshold: number; teamName(slot: number): string }) {
  const [open, setOpen] = useState(false);
  const rounds = useMemo(() => {
    const out: RecapPick[][] = [];
    for (const p of picks) (out[roundOf(p.n, teams) - 1] ??= []).push(p);
    return out;
  }, [picks, teams]);
  return (
    <section className={s.bookPicks} aria-label="Every pick">
      <button type="button" className={s.bookMore} aria-expanded={open} aria-controls="book-every-pick" onClick={() => setOpen((o) => !o)}>
        <span className={s.chev} />
        {open ? "Hide the picks" : `See all ${picks.length} picks`}
      </button>
      {open && (
        <div id="book-every-pick" className={s.rounds}>
          {rounds.map((round, i) => (
            <section key={i} className={s.round} aria-label={`Round ${i + 1}`}>
              <h4 className={s.roundHead}>Round {i + 1}</h4>
              <ol>
                {round.map((p) => {
                  const pos = p.player?.pos ?? p.label?.pos ?? null;
                  const strong = p.gain !== null && Math.abs(p.gain) >= threshold;
                  return (
                    <li key={p.n} className={cx("lrow", "bookRow", p.mine && "mine")}>
                      <span className={s.lrowP}>{p.roundPick}</span>
                      <span className={s.lrowWho}>
                        {pos && <i style={{ color: POS_COLOR[pos] }}>{posLabel(pos)}</i>}
                        {p.player?.name ?? p.label?.name ?? p.n}
                        <small className={s.bookTeam}>{teamName(p.slot)}</small>
                      </span>
                      <span className={cx("lrowT", strong && (p.gain! > 0 ? "up" : "down"))} title={p.gain === null ? undefined : "Picks after the experts' rank"}>
                        {p.gain === null ? "" : p.gain > 0 ? `+${p.gain}` : p.gain < 0 ? `−${-p.gain}` : "0"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * ESPN's team name at each draft slot, for a league that follows ESPN; null until it arrives, or
 * when it can't be read (the room says "Team 4" instead).
 */
function useDraftTeamNames(leagueId: string | null): (string | null)[] | null {
  const [names, setNames] = useState<{ id: string; names: (string | null)[] } | null>(null);
  useEffect(() => {
    if (!leagueId) return;
    const ctrl = new AbortController();
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/draft-teams`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ names: (string | null)[] }>) : null))
      .then((body) => body && setNames({ id: leagueId, names: body.names }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [leagueId]);
  return names && names.id === leagueId ? names.names : null;
}
