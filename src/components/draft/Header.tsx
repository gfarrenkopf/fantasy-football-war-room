"use client";

import { forwardRef, useCallback, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { rosterNeeds, type NeedGroup } from "@/lib/draft/roster";
import { formatRoundPick, isMyPick, nextMyPick, roundOf } from "@/lib/draft/snake";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { EspnClock } from "./EspnSync";
import { useDraftActions } from "./useDraftActions";
import { useDraftClock } from "./useDraftClock";

const SCORING_LABEL = { ppr: "Full-PPR", half: "Half-PPR", std: "Standard" } as const;

export const leagueSummary = (league: { scoring: keyof typeof SCORING_LABEL; teams: number; mySlot: number }) =>
  `${SCORING_LABEL[league.scoring]}, ${league.teams} teams, slot ${formatRoundPick(league.mySlot, league.teams)}`;

/** A row in a draft menu: a link, a switch, a choice of a few values, or an action. */
export type DraftTool =
  | { label: string; href: string; external?: boolean }
  | { label: string; checked: boolean; onToggle(): void }
  | { label: string; value: number; options: readonly { value: number; label: string }[]; onChange(value: number): void }
  | { label: string; onSelect(): void; danger?: boolean };

interface HeaderProps {
  query: string;
  onQueryChange(q: string): void;
  onQueryKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void;
  hint: string;
  /** Phone layout: the search folds behind a button in the bottom bar, and Undo keeps only its icon. */
  phone: boolean;
  /** Controls rendered after the brand (view switch). */
  children?: React.ReactNode;
  /** Where the draft is (StatusChip), on a wide screen. A phone carries it in the app bar instead. */
  status?: React.ReactNode;
  /** The mock draft's sim controls, while mock mode is on. */
  mock?: React.ReactNode;
  /** Buttons rendered at the start of the action group. */
  actions?: React.ReactNode;
  /** Shown before `actions` (ESPN sync while it's set up). */
  sync?: React.ReactNode;
  /**
   * What the draft needs now and then: setting up ESPN sync, mock mode, reset. One menu holds them
   * (Epic 15), so the header's row and the phone's bar keep only what every pick needs. The page
   * passes only the ones that apply; with none, there's no menu.
   */
  tools?: readonly DraftTool[];
  /** Whether Undo applies: not once a draft that came from ESPN is done. */
  canUndo?: boolean;
}

/**
 * The draft room's control bar (APE-322): the view switch, where the draft is, search and the draft
 * actions, in one row on a wide screen. Ported from renderHeader(), whose pick box, turn banner,
 * click-mode hint and needs strip are now the one StatusChip.
 */
export const Header = forwardRef<HTMLInputElement, HeaderProps>(function Header(
  { query, onQueryChange, onQueryKeyDown, hint, phone, children, status, mock, actions, sync, tools = [], canUndo = true },
  searchRef,
) {
  const { undo } = useDraftActions();
  // On a phone the search is a button until it's wanted. It stays open while it holds a query, so
  // the board's results don't vanish when the keyboard goes down.
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = phone && (searchOpen || query !== "");
  const input = useRef<HTMLInputElement | null>(null);
  const setInput = useCallback(
    (el: HTMLInputElement | null) => {
      input.current = el;
      if (typeof searchRef === "function") searchRef(el);
      else if (searchRef) searchRef.current = el;
    },
    [searchRef],
  );
  // Focused in the tap itself, not after a render: iOS only raises the keyboard inside the gesture.
  const openSearch = () => {
    flushSync(() => setSearchOpen(true));
    input.current?.focus();
  };
  const closeSearch = () => {
    onQueryChange("");
    setSearchOpen(false);
    input.current?.blur();
  };

  return (
    <header className={cx("header", searching && "searching")}>
      {/*
       * The view switch and the draft actions are wrapped together so mobile can lift the pair
       * into a fixed bottom bar in one move. On desktop `.bar` is display:contents, so both stay
       * direct flex children of the header and `.actions` keeps its own order.
       */}
      <div className={cx("bar", phone && !!mock && "iconsOnly")}>
        {children}
        <div className={s.actions}>
          {sync}
          {phone && (
            <button className={cx("btn", "iconBtn", "searchBtn", searching && "on")} onClick={searching ? closeSearch : openSearch} aria-label={searching ? "Close search" : "Find a player"} aria-expanded={searching}>
              <SearchIcon />
            </button>
          )}
          {actions}
          {canUndo && (
            <button className={cx("btn", "undo", phone && "iconBtn")} onClick={undo} title="Undo the last logged pick" aria-label={phone ? "Undo the last pick" : undefined}>
              {phone ? <UndoIcon /> : "Undo"}
            </button>
          )}
          {phone && mock}
          {tools.length > 0 && <DraftMenu label="Draft tools" items={tools} icon={<MoreIcon />} className="toolsBtn" />}
        </div>
      </div>
      {status}
      {!phone && mock}
      <div className={s.search}>
        <SearchIcon />
        <input
          ref={setInput}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            onQueryKeyDown(e);
            if (phone && (e.key === "Escape" || e.key === "Enter")) {
              setSearchOpen(false);
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.value.trim()) setSearchOpen(false);
          }}
          placeholder={phone ? "Find a player" : "Find a player ( / to focus, Enter to draft)"}
          aria-label="Find a player"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        <span className={s.hint}>{hint}</span>
        {phone && (
          // Held on pointerdown so the field's blur can't close the search before the tap lands.
          <button className={s.searchClose} onPointerDown={(e) => e.preventDefault()} onClick={closeSearch} aria-label="Close search">
            <CloseIcon />
          </button>
        )}
      </div>
    </header>
  );
});

/* ================= status chip ================= */

/** Phone: how many open positions show before the rest fold into "+N". */
const PHONE_PIPS = 2;

/**
 * Where the draft is, in one place (APE-322): the pick, the wait for the user's turn, and the
 * starter slots still open. It escalates in the room's grammar — rest, near (amber), on the clock
 * (green, and on a phone the one on-clock glow, since the phone drops the focus hero).
 * `data-pickbox` is where Opening Night and the Final Whistle iris down to.
 */
export function StatusChip({ arrival, compact, tip, onTipClose }: { arrival: number; compact: boolean; tip: boolean; onTipClose(): void }) {
  const model = useModel();
  const { current: cur, total, done, onClock, league, next: nxt } = model;
  const clock = useDraftClock();
  if (done) return null;

  const teams = league.teams;
  const round = Math.min(model.ctx.rounds, roundOf(Math.min(cur, total), teams));
  const needs = rosterNeeds(model.slots, round, model.ctx.rounds);
  const d = nxt - cur;
  const pair = nxt + 1 <= total && isMyPick(nxt + 1, league);

  let lead: string;
  let sub = "";
  let said: string;
  let state: "near" | "onclock" | false = false;
  if (onClock) {
    const after = nextMyPick(cur + 1, league);
    state = "onclock";
    lead = compact ? "You're up" : "On the clock";
    sub = after > total ? "final pick" : after === cur + 1 ? `again at ${after}` : `next ${after}`;
    said = `You're on the clock at pick ${cur}. ${after > total ? "It's your final pick." : `Your next pick is ${after}.`}`;
  } else if (nxt > total) {
    lead = "No picks left";
    sub = "log the rest";
    said = "You have no picks left. Log the remaining picks as they happen.";
  } else {
    state = d <= 4 && "near";
    lead = compact ? `${d} → ${nxt}` : `${d} to you`;
    sub = pair ? `picks ${nxt}–${nxt + 1}` : `pick ${nxt}`;
    said = `${d} pick${d === 1 ? "" : "s"} until your turn at pick ${nxt}${pair ? ` and ${nxt + 1}` : ""}, round ${roundOf(nxt, teams)}.`;
  }
  // Before the first pick, a league with a date says when the room fills instead.
  if (clock) {
    lead = `Draft ${clock.label}`;
    sub = onClock ? "you pick first" : `you pick ${nxt}`;
    said = `The draft starts ${clock.label}. ${said}`;
  }

  // K and D/ST wait (they're soft until the late rounds), but once every other starter is in they're
  // all that's left, so they show then whatever the round.
  const empty = (g: NeedGroup) => g.filled.some((f) => !f);
  const streaming = (g: NeedGroup) => g.key === "K" || g.key === "DST";
  const rest = needs.groups.some((g) => !streaming(g) && empty(g));
  const open = needs.groups.filter((g) => (rest ? g.open : empty(g))).sort((a, b) => Number(b.urgent) - Number(a.urgent));
  const shown = compact ? open.slice(0, PHONE_PIPS) : open;
  const needSaid = open.length ? `Starters still to fill: ${open.map((g) => g.label).join(", ")}.` : needs.allStartersFilled ? "Every starter slot is filled." : "Starters set for now.";

  return (
    <div className={s.statusWrap}>
      <div className={cx("status", state, compact && "compact")} data-pickbox title={`${said} ${needSaid}`}>
        {arrival > 0 && onClock && <span key={arrival} className={s.sweep} aria-hidden="true" />}
        {/* The visible chip is shorthand; this is what it says, read whenever it changes. */}
        <span className="sr-only" role="status">
          Pick {cur}, round {roundOf(cur, teams)} pick {((cur - 1) % teams) + 1}. {said} {needSaid}
        </span>
        <span className={s.stPick} aria-hidden="true">
          {/* Keyed by arrival so the number pops again each time the clock comes back to the user. */}
          <b key={arrival} className={cx("stNum", arrival > 0 && onClock && "pop")}>
            {Math.min(cur, total)}
          </b>
          {!compact && <span className={s.stRp}>{formatRoundPick(cur, teams)}</span>}
        </span>
        <span className={s.stRule} aria-hidden="true" />
        <span className={s.stTurn} aria-hidden="true">
          <b>{lead}</b>
          {!compact && sub && <small>{sub}</small>}
        </span>
        <EspnClock />
        <span className={s.stRule} aria-hidden="true" />
        <span className={s.pips} aria-hidden="true">
          {shown.length ? (
            shown.map((g) => <NeedPip key={g.key} group={g} />)
          ) : (
            <span className={cx("pip", "pipSet", needs.allStartersFilled && "full")}>
              <CheckIcon />
              {!compact && (needs.allStartersFilled ? "Starters" : "Set for now")}
            </span>
          )}
          {open.length > shown.length && <span className={s.pipMore}>+{open.length - shown.length}</span>}
        </span>
      </div>
      {tip && <ClickTip touch={compact} onClose={onTipClose} />}
    </div>
  );
}

/** An open starter position: its label in the position's hue, and a ring per empty slot. Pulses when it's getting late. */
function NeedPip({ group }: { group: NeedGroup }) {
  return (
    <span className={cx("pip", group.urgent && "urgent")} data-pos={group.key}>
      <b>{group.label}</b>
      {group.filled.map((f, i) => !f && <i key={i} />)}
    </span>
  );
}

/**
 * How clicking a player logs a pick, once per device (APE-322). It used to sit in the header as a
 * permanent hint; now it shows until dismissed, and "How picking works" brings it back.
 */
function ClickTip({ touch, onClose }: { touch: boolean; onClose(): void }) {
  const titleId = useId();
  return (
    <div className={s.clickTip} role="dialog" aria-labelledby={titleId}>
      <b id={titleId}>Logging picks</b>
      {touch ? (
        <p>
          Tap a player to log the pick: <em>yours</em> when you&apos;re on the clock, <em>another team&apos;s</em> the rest of the time. The ✕ on a row always logs another team&apos;s.
        </p>
      ) : (
        <p>
          Click a player to log the pick: <em>yours</em> when you&apos;re on the clock, <em>another team&apos;s</em> the rest of the time. <kbd>Shift</kbd>-click forces yours; <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>-click forces another team&apos;s.
        </p>
      )}
      <button className={cx("btn", "primary")} onClick={onClose}>
        Got it
      </button>
    </div>
  );
}

/* ================= menus ================= */

/**
 * A menu of draft rows behind one button (Epic 15): the draft tools, and on a phone the mock
 * draft's sims. On a wide screen it hangs under the button; on a phone it rises above the bottom
 * bar as a sheet.
 */
export function DraftMenu({ label, items, icon, className, iconOnly }: { label: string; items: readonly DraftTool[]; icon: React.ReactNode; className?: string; iconOnly?: boolean }) {
  const id = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const pick = (action: () => void) => () => {
    sheet.current?.hidePopover();
    action();
  };
  return (
    <>
      <button className={cx("btn", "menuBtn", className)} popoverTarget={id} aria-haspopup="menu" title={label} aria-label={iconOnly ? label : undefined}>
        {icon}
        {!iconOnly && <span className={s.toolsLabel}>{label}</span>}
      </button>
      <div ref={sheet} id={id} popover="auto" role="menu" className={s.toolsSheet} aria-label={label}>
        {items.map((tool) =>
          "href" in tool ? (
            <a key={tool.label} role="menuitem" className={s.toolsItem} href={tool.href} {...(tool.external ? { target: "_blank", rel: "noreferrer" } : {})}>
              {tool.label}
            </a>
          ) : "checked" in tool ? (
            <button key={tool.label} role="menuitemcheckbox" aria-checked={tool.checked} className={s.toolsItem} onClick={pick(tool.onToggle)}>
              {tool.label}
              <span className={s.toolsState}>{tool.checked ? "On" : "Off"}</span>
            </button>
          ) : "options" in tool ? (
            // A choice stays open while it's made, so the row shows what it changed to.
            <div key={tool.label} role="group" aria-label={tool.label} className={cx("toolsItem", "toolsChoice")}>
              {tool.label}
              <span className={s.toolsSeg}>
                {tool.options.map((o) => (
                  <button key={o.value} role="menuitemradio" aria-checked={tool.value === o.value} onClick={() => tool.onChange(o.value)}>
                    {o.label}
                  </button>
                ))}
              </span>
            </div>
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

/* ================= icons: 16px, 1.6 stroke ================= */

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg className={s.icon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {children}
  </svg>
);
export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.6" />
    <path d="m13.5 13.5-3.2-3.2" />
  </Icon>
);
export const UndoIcon = () => (
  <Icon>
    <path d="M5.5 3 2.5 6l3 3" />
    <path d="M2.8 6h6.7a3.8 3.8 0 0 1 0 7.6H6.5" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon>
    <path d="m3 8.5 3.2 3L13 4.5" />
  </Icon>
);
export const MoreIcon = () => (
  <svg className={s.iconFill} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="3.5" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="12.5" cy="8" r="1.4" />
  </svg>
);
/** The turn plan: three target rows, the top one yours. */
export const PlanIcon = () => (
  <Icon>
    <path d="M2.5 4h2M2.5 8h2M2.5 12h2" />
    <path d="M7 4h6.5M7 8h4.5M7 12h3" />
  </Icon>
);
/** Sim to my pick: play, up to a bar. */
export const SimToMeIcon = () => (
  <Icon>
    <path d="M3 3.5v9l6.5-4.5z" />
    <path d="M12.5 3.5v9" />
  </Icon>
);
/** Sim one pick. */
export const SimOneIcon = () => (
  <Icon>
    <path d="M5 3.5v9l6.5-4.5z" />
  </Icon>
);
/** Sim the full draft. */
export const SimAllIcon = () => (
  <Icon>
    <path d="M2 3.5v9L7.5 8zM8.5 3.5v9L14 8z" />
  </Icon>
);
export const StopIcon = () => (
  <Icon>
    <rect x="4" y="4" width="8" height="8" rx="1" />
  </Icon>
);
