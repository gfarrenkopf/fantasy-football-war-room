"use client";

import { forwardRef } from "react";
import { formatRoundPick, isMyPick, nextMyPick, roundOf } from "@/lib/draft/snake";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { useLeague } from "./LeagueProvider";
import { useDraftActions } from "./useDraftActions";

/** Option value in the league switcher that opens the new-league dialog instead of switching. */
const NEW_LEAGUE = "__new__";

const SCORING_LABEL = { ppr: "Full-PPR", half: "Half-PPR", std: "Standard" } as const;

export const leagueSummary = (league: { scoring: keyof typeof SCORING_LABEL; teams: number; mySlot: number }) =>
  `${SCORING_LABEL[league.scoring]}, ${league.teams} teams, slot ${formatRoundPick(league.mySlot, league.teams)}`;

interface HeaderProps {
  query: string;
  onQueryChange(q: string): void;
  onQueryKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void;
  hint: string;
  onOpenLeague(): void;
  onNewLeague(): void;
  /** Controls rendered after the brand (view switch). */
  children?: React.ReactNode;
  /** Buttons rendered at the start of the action group. */
  actions?: React.ReactNode;
  /** Sign-in state, rendered after the draft actions. */
  account?: React.ReactNode;
  /** Roster needs strip, rendered after search. */
  needs?: React.ReactNode;
}

/** Pick box, turn state, click-mode hint, search and draft actions. Ported from renderHeader(). */
export const Header = forwardRef<HTMLInputElement, HeaderProps>(function Header({ query, onQueryChange, onQueryKeyDown, hint, onOpenLeague, onNewLeague, children, actions, account, needs }, searchRef) {
  const model = useModel();
  const { undo, reset } = useDraftActions();
  const { leagues, active, switchLeague } = useLeague();
  const { current: cur, total, done, onClock, league } = model;

  let turn: React.ReactNode;
  let turnClass: string | false = false;
  let mode: React.ReactNode;
  if (done) {
    turn = (
      <>
        <b>Draft complete</b>
        <small>{total} picks made</small>
      </>
    );
    mode = (
      <>
        <b>Draft over</b>use Undo to correct
      </>
    );
  } else if (onClock) {
    const nxt = nextMyPick(cur + 1, league);
    turnClass = "onclock";
    turn = (
      <>
        <b>You&apos;re on the clock — pick {cur}</b>
        <small>{nxt <= total ? (nxt === cur + 1 ? `and again at ${cur + 1}` : `next after this: pick ${nxt}`) : "final pick"}</small>
      </>
    );
    mode = (
      <>
        <b>Click = your pick</b>Cmd/Ctrl-click = another team
      </>
    );
  } else {
    const nxt = model.next;
    const d = nxt - cur;
    turnClass = d <= 4 && "near";
    turn =
      nxt > total ? (
        <>
          <b>No picks left for you</b>
          <small>log the remaining picks as they happen</small>
        </>
      ) : (
        <>
          <b>
            {d} pick{d === 1 ? "" : "s"} until your turn at {nxt}
          </b>
          <small>
            then {nxt + 1 <= total && isMyPick(nxt + 1, league) ? `pick ${nxt + 1} right after` : "one pick"} (round {roundOf(nxt, league.teams)})
          </small>
        </>
      );
    mode = (
      <>
        <b>Click = another team&apos;s pick</b>Shift-click = force yours
      </>
    );
  }

  return (
    <header className={s.header}>
      <div className={s.brand}>
        <b>Fantasy War Room</b>
        {active ? (
          <select
            className={s.leagueSelect}
            aria-label="League"
            title={leagueSummary(league)}
            value={active.id}
            onChange={(e) => (e.target.value === NEW_LEAGUE ? onNewLeague() : switchLeague(e.target.value))}
          >
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value={NEW_LEAGUE}>+ New league…</option>
          </select>
        ) : null}
        <span>{leagueSummary(league)}</span>
      </div>
      {/*
       * The view switch and the draft actions are wrapped together so mobile can lift the pair
       * into a fixed bottom bar in one move. On desktop `.bar` is display:contents, so both stay
       * direct flex children of the header exactly as before and `.actions` keeps its own order.
       */}
      <div className={s.bar}>
        {children}
        <div className={s.actions}>
          {actions}
          <button className={s.btn} onClick={onOpenLeague} title="League size, draft slot, scoring and roster">
            League
          </button>
          <button className={cx("btn", "undo")} onClick={undo} title="Undo the last logged pick">
            Undo
          </button>
          <button className={cx("btn", "danger")} onClick={() => void reset()}>
            Reset draft
          </button>
          {account}
        </div>
      </div>
      <div className={s.pickbox}>
        <div>
          <div className={s.big}>{Math.min(cur, total)}</div>
          <div className={s.lbl}>current pick</div>
        </div>
        <div>
          <div className={s.rpText}>{done ? "done" : formatRoundPick(cur, league.teams)}</div>
          <div className={s.lbl}>round.pick</div>
        </div>
      </div>
      <div className={cx("turn", turnClass)} aria-live="polite">
        {turn}
      </div>
      <div className={cx("clickmode", onClock && "me")}>{mode}</div>
      <div className={s.search}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onQueryKeyDown}
          placeholder="Find a player ( / to focus, Enter to draft)"
          aria-label="Find a player"
          autoComplete="off"
          spellCheck={false}
        />
        <span className={s.hint}>{hint}</span>
      </div>
      {needs}
    </header>
  );
});
