"use client";

import { forwardRef, useId, useRef } from "react";
import { formatRoundPick, isMyPick, nextMyPick, roundOf } from "@/lib/draft/snake";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { EspnClock } from "./EspnSync";
import { useDraftActions } from "./useDraftActions";
import { useDraftClock } from "./useDraftClock";

const SCORING_LABEL = { ppr: "Full-PPR", half: "Half-PPR", std: "Standard" } as const;

export const leagueSummary = (league: { scoring: keyof typeof SCORING_LABEL; teams: number; mySlot: number }) =>
  `${SCORING_LABEL[league.scoring]}, ${league.teams} teams, slot ${formatRoundPick(league.mySlot, league.teams)}`;

/** A row in the draft tools menu: a link, a switch, or an action. */
export type DraftTool =
  | { label: string; href: string; external?: boolean }
  | { label: string; checked: boolean; onToggle(): void }
  | { label: string; onSelect(): void; danger?: boolean };

interface HeaderProps {
  query: string;
  onQueryChange(q: string): void;
  onQueryKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void;
  hint: string;
  /** Bumped each time a pick puts the user on the clock; replays the pick box and turn banner's arrival. */
  arrival: number;
  /** Controls rendered after the brand (view switch). */
  children?: React.ReactNode;
  /** Buttons rendered at the start of the action group. */
  actions?: React.ReactNode;
  /** Status shown before `actions` (ESPN sync while it's set up). */
  status?: React.ReactNode;
  /**
   * What the draft needs now and then: setting up ESPN sync, mock mode, reset. One menu holds them
   * (Epic 15), so the header's row and the phone's bar keep only what every pick needs. The page
   * passes only the ones that apply; with none, there's no menu.
   */
  tools?: readonly DraftTool[];
  /** Whether Undo applies: not once a draft that came from ESPN is done. */
  canUndo?: boolean;
  /** Roster needs strip, rendered after search. */
  needs?: React.ReactNode;
}

/** Pick box, turn state, click-mode hint, search and draft actions. Ported from renderHeader(). */
export const Header = forwardRef<HTMLInputElement, HeaderProps>(function Header({ query, onQueryChange, onQueryKeyDown, hint, arrival, children, actions, status, tools = [], canUndo = true, needs }, searchRef) {
  const model = useModel();
  const { undo } = useDraftActions();
  const { current: cur, total, done, onClock, league } = model;
  // Before the first pick, the turn line also says when the draft starts: on a phone, whose
  // header drops the focus hero, this is the only place the countdown shows.
  const clock = useDraftClock();
  const startsIn = clock ? ` · draft ${clock.label}` : "";

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
        <b>In the books</b>
        {canUndo ? "Undo corrects a pick" : "Synced from ESPN"}
      </>
    );
  } else if (onClock) {
    const nxt = nextMyPick(cur + 1, league);
    turnClass = "onclock";
    turn = (
      <>
        <b>You&apos;re on the clock — pick {cur}</b>
        <small>
          {nxt <= total ? (nxt === cur + 1 ? `and again at ${cur + 1}` : `next after this: pick ${nxt}`) : "final pick"}
          {startsIn}
        </small>
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
            {startsIn}
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
      {/*
       * The view switch and the draft actions are wrapped together so mobile can lift the pair
       * into a fixed bottom bar in one move. On desktop `.bar` is display:contents, so both stay
       * direct flex children of the header exactly as before and `.actions` keeps its own order.
       */}
      <div className={s.bar}>
        {children}
        <div className={s.actions}>
          {status}
          {actions}
          {canUndo && (
            <button className={cx("btn", "undo")} onClick={undo} title="Undo the last logged pick">
              Undo
            </button>
          )}
          {tools.length > 0 && <ToolsMenu tools={tools} />}
        </div>
      </div>
      {/* data-pickbox: where OpeningNight's stage irises down to when the draft starts. */}
      <div className={s.pickbox} data-pickbox>
        <div>
          {/* Keyed by arrival so the number pops again each time the clock comes back to the user. */}
          <div key={arrival} className={cx("big", arrival > 0 && onClock && "pop")}>
            {Math.min(cur, total)}
          </div>
          <div className={s.lbl}>current pick</div>
        </div>
        <div>
          <div className={s.rpText}>{done ? "done" : formatRoundPick(cur, league.teams)}</div>
          <div className={s.lbl}>round.pick</div>
        </div>
      </div>
      <div className={cx("turn", turnClass)} aria-live="polite">
        {arrival > 0 && onClock && <span key={arrival} className={s.sweep} aria-hidden="true" />}
        {!done && <EspnClock />}
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

/**
 * The draft tools menu (Epic 15): what the draft needs now and then, behind one button. On a wide
 * screen it hangs under the button; on a phone it rises above the bottom bar as a sheet.
 */
function ToolsMenu({ tools }: { tools: readonly DraftTool[] }) {
  const id = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const pick = (action: () => void) => () => {
    sheet.current?.hidePopover();
    action();
  };
  return (
    <>
      <button className={cx("btn", "toolsBtn")} popoverTarget={id} aria-haspopup="menu" title="Draft tools">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="3.5" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="12.5" cy="8" r="1.4" />
        </svg>
        <span className={s.toolsLabel}>Draft tools</span>
      </button>
      <div ref={sheet} id={id} popover="auto" role="menu" className={s.toolsSheet} aria-label="Draft tools">
        {tools.map((tool) =>
          "href" in tool ? (
            <a key={tool.label} role="menuitem" className={s.toolsItem} href={tool.href} {...(tool.external ? { target: "_blank", rel: "noreferrer" } : {})}>
              {tool.label}
            </a>
          ) : "checked" in tool ? (
            <button key={tool.label} role="menuitemcheckbox" aria-checked={tool.checked} className={s.toolsItem} onClick={pick(tool.onToggle)}>
              {tool.label}
              <span className={s.toolsState}>{tool.checked ? "On" : "Off"}</span>
            </button>
          ) : (
            <button key={tool.label} role="menuitem" className={cx("toolsItem", tool.danger && "toolsDanger")} onClick={pick(tool.onSelect)}>
              {tool.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}
