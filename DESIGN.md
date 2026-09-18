---
name: Fantasy War Room
description: A dim-room draft instrument where position color carries meaning and urgency escalates as your pick approaches.
colors:
  bg: "#1a1e25"
  panel: "#22272f"
  panel2: "#282e37"
  line: "#323a45"
  line2: "#3d4654"
  text: "#e7ebf0"
  muted: "#8f9aa8"
  dim: "#5f6a78"
  qb: "#e5484d"
  rb: "#3ddc91"
  wr: "#4f9cf9"
  te: "#f59e42"
  k: "#b39ddb"
  dst: "#9aa7b8"
  value: "#22c55e"
  reach: "#ef4444"
  warn: "#fbbf24"
  mine: "#3ddc91"
  focus: "#7cb7ff"
  chip: "#2f3743"
  hover: "#2a303a"
  tier: "#1f242c"
  strip: "#1e232b"
  row-line: "#2a3039"
  btn-hover: "#333c48"
  seg-on: "#3a4453"
  done: "#4a5566"
  value-ink: "#5ee39a"
  reach-ink: "#ff8a8a"
  warn-ink: "#f5d27a"
  soft-red: "#ff9a9a"
  bye-ink: "#aab4c2"
  mine-ink: "#0d1a14"
  sky: "#9be1ff"
  sky-line: "#2c7a9a"
typography:
  display:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "56px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-1px"
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.3
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.2
  micro:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    lineHeight: 1.15
rounded:
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "6px"
  xl: "8px"
  pill: "999px"
spacing:
  hair: "3px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
components:
  button:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "7px 11px"
  button-hover:
    backgroundColor: "{colors.btn-hover}"
    textColor: "{colors.text}"
  button-primary:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.sky}"
    rounded: "{rounded.lg}"
    padding: "7px 11px"
  button-danger-hover:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.soft-red}"
  segment-on:
    backgroundColor: "{colors.seg-on}"
    textColor: "#ffffff"
    padding: "7px 13px"
  input:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "6px 8px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.xl}"
  panel-title:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    padding: "7px 10px"
  player-card:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "4px 6px 4px 8px"
  player-card-hover:
    backgroundColor: "{colors.hover}"
  player-card-mine:
    textColor: "{colors.mine}"
    padding: "4px 6px 4px 5px"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  tag-value:
    textColor: "{colors.value-ink}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  tag-reach:
    textColor: "{colors.reach-ink}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  tier-header:
    backgroundColor: "{colors.tier}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "4px 10px"
---

# Design System: Fantasy War Room

## Overview

**Creative North Star: "The Situation Room"**

A dim room with one lit board. The interface sits at rest — near-monochrome, hairline-ruled, almost inert — and escalates only as the user's turn approaches: a border warms to amber, a panel starts breathing on a 1.6s glow, a counter turns from muted grey to alarm. Nothing on this surface is decorative. Every color, every weight change, every pixel of the 13px root type is spent on a fact the user needs while a pick clock runs somewhere else on their desk.

The density is deliberate and it is not an apology. Base font size is 13px, line-height 1.3, numerals tabular everywhere so ranks and ADPs align into readable columns. A player card is a four-column grid 22 pixels tall carrying rank, name, team, bye, position, two ranks, and a Value/Reach verdict. That is the register of a professional instrument, not a consumer app, and the user reading it has seconds and divided attention.

The personality lives entirely in the gap between rest and alarm. Chrome recedes — buttons are 7px-padded panels that barely separate from their background, hover is a tone shift of a few percent, the segmented control's only tell is a slightly lighter fill. Then state arrives and the system commits completely: the mine card takes a 6px green rail, floods 16% green, swaps its rank badge for a checkmark, and turns its name green. There is no middle register, and there should not be.

**Key Characteristics:**
- Dark-only, five stepped surface tones from `#1a1e25` to `#3d4654`, no light mode
- 13px root, tabular numerals, 10px–15px working range; one 56px number as the sole display moment
- Six position hues doing nearly all semantic work, on an otherwise neutral ground
- 1px hairlines instead of shadows; depth by tone, not by lift
- Escalation as the core grammar: rest → warn (amber) → on-clock (green, pulsing)
- Reduced-motion honored on every animation in the system

## Colors

A near-neutral blue-grey ground carrying six saturated position hues and a small signal set; the ground never competes, and saturation only appears where it means something.

### Primary

- **Signal Green** (`#3ddc91`): the yes-color. It marks running backs, marks picks the user owns (16% fill, 6px left rail, checkmark badge, green name), and drives the on-clock glow. The single loudest color in the system.
- **Alert Amber** (`#fbbf24`): approach and conflict. Warms the turn box as the pick nears, flags bye-week collisions on player cards (18% fill, 55% border, a ⚠ glyph), pulses the roster-needs strip when a need is urgent.

### Secondary

The six position hues. These are load-bearing, not thematic: they appear as a 3px left rail on every player card, as the rank badge and position-label ink, and as the 10px column dot.

- **Quarterback Red** (`#e5484d`)
- **Running Back Green** (`#3ddc91`)
- **Receiver Blue** (`#4f9cf9`)
- **Tight End Amber** (`#f59e42`)
- **Kicker Lilac** (`#b39ddb`)
- **Defense Slate** (`#9aa7b8`) — deliberately desaturated; DST is a streaming position and reads as almost-neutral

### Tertiary

The signal layer, used only on verdicts and states.

- **Value Green** (`#22c55e`) with **Value Ink** (`#5ee39a`): a pick ahead of market. Tag is 18% fill, 45% border, bright ink.
- **Reach Red** (`#ef4444`) with **Reach Ink** (`#ff8a8a`): a pick behind market. Same construction at 16%/45%.
- **Focus Blue** (`#7cb7ff`): the 2px focus ring, and the 12% wash on a search hit.
- **Terminal Sky** (`#9be1ff`) on **Sky Line** (`#2c7a9a`): the primary-button voice — an outlined, tinted button rather than a filled one.

### Neutral

- **Room Black** (`#1a1e25`): the app ground. Everything sits on it.
- **Panel Slate** (`#22272f`): every column, card container, and panel.
- **Raised Slate** (`#282e37`): inputs, buttons, panel headers, the pick box — anything interactive or heading-like.
- **Hairline** (`#323a45`) and **Hairline Bright** (`#3d4654`): the 1px borders that do all the structural work.
- **Row Line** (`#2a3039`): the divider between player cards, one step darker than a panel border so 40 stacked rows don't read as a cage.
- **Paper White** (`#e7ebf0`), **Muted** (`#8f9aa8`), **Dim** (`#5f6a78`): the three-step text ramp. Muted is for secondary facts, Dim for placeholders and null verdicts.
- **Tier Ground** (`#1f242c`) and **Strip Ground** (`#1e232b`): recessed bands for sticky tier headers and the top strip — darker than the panel they sit in, so structure reads as carved rather than stacked.

### Named Rules

**The Earned Saturation Rule.** The ground, the panels, the borders, and the text ramp are all within a few degrees of the same blue-grey. Saturation is reserved: a color appears only where it encodes position, verdict, or state. A new surface that needs a color it cannot justify semantically gets a neutral.

**The Translucent Signal Rule.** Signal backgrounds are never opaque. Every state fill is `color-mix(in srgb, var(--color-X) N%, transparent)` at 7–18%, with a matching border at 45–60%. This keeps the ground visible through the state, so an alarmed row still reads as part of the same board.

**The Double-Duty Green Warning.** `--color-rb` and `--color-mine` are the same hex (`#3ddc91`) by inheritance, not by design. A drafted running back therefore wears one color meaning two things. This is a known flaw; a future pass should separate ownership from position rather than deepen the coupling.

## Typography

**Display Font:** Segoe UI Variable Text (with Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif)
**Body Font:** the same stack — this is a single-family system
**Label/Mono Font:** none. Numeric alignment comes from `font-variant-numeric: tabular-nums` on `body`, not from a second family.

**Character:** One neutral UI face carrying the entire system, with hierarchy built from size and weight alone. The choice reads as infrastructural rather than authored — which is correct for an instrument, but it is also the least deliberate part of the system and the most obvious place a future pass could add intent.

### Hierarchy

- **Display** (700, 56px, line-height 1, letter-spacing -1px): the current pick number in the focus view hero. Exactly one instance in the product; its scale is the whole point.
- **Headline** (700, 24px, line-height 1): the header's pick counter. The only other number given size.
- **Title** (600, 15px, line-height 1.3): brand name, round/pick text, hero secondary line.
- **Body** (600, 12.5px): the player name — the most-read string in the product, weighted up rather than sized up, and truncated with ellipsis inside a `minmax(0, 1fr)` grid column.
- **Label** (400, 11px, line-height 1.2): secondary facts everywhere — team/bye line, panel subtitles, tier metadata, hints, placeholders.
- **Micro** (700, 10.5px, line-height 1.15): verdict tags, rank pairs, slot labels. Small but bold, so it survives at the size.

### Named Rules

**The Weight-Not-Size Rule.** Hierarchy below 15px is built with weight (400 → 600 → 700) and the three-step text ramp, not with size. The working range is 10px–15px and it stays there; a new element that wants to feel important gets weight and ink, not points.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set on `body` and must never be overridden. Ranks, ADPs, pick numbers, and bye weeks are read as columns; proportional digits break the scan.

## Layout

The app is a single full-height flex column at `100dvh` with `overflow: hidden` — the page itself never scrolls, only the panels inside it do. A fixed header sits on top; below it, one of two view modes fills the remaining height.

**Board view** is a six-column CSS grid with weighted, uneven tracks: `minmax(250px, 1fr)` for QB, `minmax(290px, 1.12fr)` for RB and WR — the two positions drafted most and needing the most room — `minmax(250px, 1fr)` for TE, `minmax(225px, 0.82fr)` for K/DST, and a fixed `300px` rail. Gap 8px, padding 8px, with `overflow-x: auto` as the only concession to narrow screens. Above it sits a 34px best-available strip.

**Focus view** is a three-column grid, `minmax(280px, 350px) / minmax(0, 1fr) / minmax(280px, 340px)`, gap 10px. At `max-width: 1500px` the side columns fix to 290px and the gap and padding tighten to 8px. Inner grids are self-sizing: target groups at `repeat(auto-fill, minmax(290px, 1fr))`, best-available at 240px, roster slot pickers at 180px.

**Rhythm.** A tight even scale — 3, 4, 6, 8, 10, 14 — applied as: 4px inside a row, 6–8px between controls, 8px between panels, 10–14px inside a hero or dialog. Panel headers are `7px 10px`; player cards `4px 6px 4px 8px`.

**Responsive.** Three bands, and the phone is a designed state rather than a fallback.

- **≥1100px — the full board.** Six weighted columns, the header as one wrapping flex row, hover-revealed controls.
- **768–1099px — the carousel.** The six columns stop fitting, so the board becomes a horizontally snapping track of `46%`-wide pages. The header is unchanged.
- **≤767px — the phone.** The header keeps only what is read under a clock (pick number, turn state, search, roster needs) as a four-row grid; the view switch and every draft action move to a fixed bottom bar in the thumb zone; the board track goes to `88%` pages so the next column peeks; the focus view's three columns flatten (`.fcol { display: contents }`) into one scrolling column re-ordered by decision value, with the pick log last. Picking comes first there: the hero, then the turn plan / best available accordion, while My roster, Starter byes and Recent picks fold to one tappable summary line each (a stacked bye week shows ⚠ on the folded line). The hero is the one statement of the pick number and turn state; the header drops both in focus view. A search on the board replaces the carousel with one consensus-ordered list of matches, whose top row is what Enter drafts, and a tap clears it. Modifier-key instructions are hidden, because there are none.

**Touch.** Target sizing switches on `(pointer: coarse), (max-width: 767px)` — either signal earns it, so a touchscreen laptop gets thumb targets without losing its columns, and a phone browser that misreports its pointer still gets them. Rows go to 44px by padding alone; no information is dropped. The `✕` "another team" control leaves `:hover` and becomes permanently visible, because it is the only way to log someone else's pick without a modifier key.

**Safe areas.** `viewport-fit=cover` with `env(safe-area-inset-*)` paid back on the header, the bottom bar, the drawer head and the drawer body.

Anything that must overflow does so as a named, snapping or scrolling rail — the action bar, needs strip, mock bar, best-available strip, board track. The document itself never scrolls sideways at any width.

### Named Rules

**The Page Never Scrolls Rule.** The root is `100dvh` / `overflow: hidden`. Scrolling belongs to individual panels via `.scroll`, so the header, strip, and column titles stay fixed while a 200-player list moves under them. A new surface that makes the document itself scroll has broken the instrument.

**The Weighted Column Rule.** Board columns are sized by how much the position is drafted, not equally. RB and WR get 1.12fr and a 290px floor; K/DST get 0.82fr and 225px. Equal columns would be tidier and worse.

**The Same Board Rule.** Narrow screens re-seat the information architecture; they never reduce it. The phone shows the same six position groups, the same tiers, the same Value/Reach verdicts and the same bye warnings as the 1440px board — as pages you swipe rather than columns you scan. A mobile layout that drops a position, a column, or a verdict has answered the wrong question.

**The Reachable Action Rule.** Below 767px, every control the user touches mid-draft lives in the fixed bottom bar, ordered by how often a thumb needs it: Undo, Turn plan, then the rest, with the destructive Reset last in the rail. Nothing the draft depends on sits in the top-right corner of a phone.

## Elevation & Depth

Depth in this system is **tonal, not cast**. Five stepped surface values (`#1a1e25` ground → `#1f242c` recessed tier band → `#22272f` panel → `#282e37` raised control → `#3d4654` bright hairline) plus 1px borders do all the structural work. The app surface itself carries no shadow at any elevation.

Shadows appear in exactly three places, all of them things floating *above* the app: the drawer (`-10px 0 30px rgb(0 0 0 / 0.4)`, cast sideways from the right edge), and modal dialogs and the availability report (`0 20px 60px rgb(0 0 0 / 0.5)`), over a `rgb(0 0 0 / 0.35)` scrim.

The one thing the app surface *does* get is **ring-glow as urgency**: `box-shadow: 0 0 0 3px <color-mix>` animated on an alternating 1.2s–1.6s ease-in-out cycle, amber for an urgent roster need and green for on-clock. This is the only animated elevation in the product and both instances are disabled under `prefers-reduced-motion`.

**Status: this flatness is inherited from the prototype, not chosen.** The user has explicitly marked it open for revision. Treat the current vocabulary as the documented baseline, not an invariant — a future pass may legitimately introduce depth, and should do so deliberately rather than by accretion.

### Shadow Vocabulary

- **Drawer cast** (`box-shadow: -10px 0 30px rgb(0 0 0 / 0.4)`): the right-edge drawer only, directional so the panel reads as sliding over the board.
- **Overlay lift** (`box-shadow: 0 20px 60px rgb(0 0 0 / 0.5)`): modal dialogs and the availability report, always paired with the scrim.
- **Urgency ring** (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warn|mine) 35–45%, transparent)`, animated): on-clock hero and urgent needs pill. Never static, never decorative.

### Named Rules

**The Glow-Means-Now Rule.** An animated ring means "this concerns your very next action." It is the scarcest signal in the system — two instances product-wide — and adding a third without removing one devalues both.

## Shapes

A restrained, mostly-square form language on a tight radius ladder: **2px** (position dots), **3px** (bye pills, track squares, micro badges), **4px** (rank badges, verdict tags, small buttons), **6px** (buttons, inputs, segmented controls, the turn box — the system's default), **8px** (panels, columns, heroes), **10px** (drawers and dialogs), **999px** (best-available chips only), and **50%** (the 7px injury-note dot).

The rule underneath the ladder is scale-proportional: the smaller the element, the tighter the corner. Nothing exceeds 10px, so no surface ever reads as soft.

Borders are the primary form-maker. Every panel, button, input, chip, tag, and row divider is defined by a 1px hairline rather than by fill contrast alone. Two deviations carry meaning: the **3px left rail** on every player card (6px when the pick is the user's — the one place a border is a statement rather than an edge), and the **1px dashed** border on the click-mode indicator, marking it as a mode annunciator rather than a control.

### Named Rules

**The Hairline-First Rule.** Structure is drawn with 1px borders on the `line`/`line2` tokens, not with fills, gaps, or shadows. When two adjacent surfaces need separating, the answer is a hairline.

**The Pill Is Reserved Rule.** `999px` appears on exactly one component — the best-available chip — so a fully-round element always means "a tappable player suggestion." Everything else lives on the 2–10px ladder.

## Components

### Buttons

- **Shape:** 6px radius, 1px `line` border, `7px 11px` padding. Small and unemphatic by design.
- **Default:** raised slate fill (`#282e37`), paper-white text. Reads as barely separated from its surroundings.
- **Hover:** fill shifts to `#333c48`. Tone only — no lift, no border change, no transform.
- **Primary:** *not* a filled button. Keeps the same fill, takes a `#2c7a9a` border and `#9be1ff` text — an outlined, tinted voice. Primary here means "tinted," never "loud."
- **Danger:** neutral at rest; on hover the border goes reach-red and the text goes `#ff9a9a`. Destruction announces itself only on approach.
- **Disabled:** `opacity: 0.4`, `cursor: default`.
- **Focus:** 2px `#7cb7ff` outline at 1px offset, set globally in `globals.css` — never overridden per component.

### Segmented Control

A single 6px-radius, overflow-hidden box with internal 1px dividers and no gaps. Off segments are muted text on raised slate; the on segment is pure white on `#3a4453`. `7px 13px` padding. The view switcher and scoring picker both use it.

### Player Card — the signature component

The most important element in the product and the densest. A four-column grid — `30px / minmax(0, 1fr) / auto / 22px` — at roughly 22px tall, carrying rank badge, name + team/bye line, rank pair + verdict tag, and a hidden-until-hover dismiss button.

- **Position rail:** 3px left border in the position hue. Also drives rank-badge ink and position-label ink.
- **Rank badge:** 11px/700, centered, 4px radius, `#2f3743` chip ground, position-colored ink.
- **Bye pill:** neutral chip at rest. On a two-player bye collision it takes an 18% amber fill, 55% amber border, and a `⚠` prefix; on three-plus it escalates to red.
- **Verdict tag:** `min-width: 52px` so the column never ragged-edges. Value and Reach are translucent-filled with matching borders; Even and N/A are dim text on a transparent border, holding the same footprint so rows stay aligned.
- **Taken:** `opacity: 0.32`, 2px line-through on the name, dismiss button hidden.
- **Mine:** overrides taken entirely — full opacity, 16% green fill, 6px green rail (padding compensated to 5px so the row doesn't shift), green name with line-through removed, and the rank badge swapped to a solid green square with a `✓` in near-black `#0d1a14`.
- **Search hit:** 12% focus-blue wash.
- **Compact variant:** in the narrow QB/TE/K/DST columns the stats block turns vertical, the rank pair goes to four columns at 10px, and the N/A tag hides entirely.

### Panels and Columns

8px radius, `#22272f` fill, 1px `line` border, `overflow: hidden`, flex-column with `min-height: 0` so inner scroll regions work. Headers are a `7px 10px` band on `#282e37` at 12px/600 with a bottom hairline; an optional 10px position dot (2px radius) leads, and counts right-align via `margin-left: auto`.

### Tier Headers

Sticky bands (`position: sticky; top: 0; z-index: 2`) inside scrolling columns. 11px muted text on `#1f242c` — *darker* than the panel around them — with hairlines top and bottom, tier number in paper white, metadata pushed right. Recessed rather than raised, so they read as grooves cut into the list.

### Inputs

`#282e37` fill, 1px `line` border, 6px radius, `6px 8px` padding (`8px 10px 8px 30px` for the search field, whose 14px stroked magnifier sits absolutely at 9px/9px). Placeholder in `dim` (`#5f6a78`). Setup fields use a `150px / 1fr` label-value grid. No dedicated error styling on the field itself — validation surfaces as a list above the footer.

### Chips

The only pill in the system (`999px`), `3px 8px` on panel fill with a `line` border. Contains a bold 10px position flag in near-black `#111` on the position hue, plus muted rank text. Hover brightens the border to `line2` and the fill to `hover`.

### Status Pills

The turn box and hero state block share one escalation vocabulary across three states: **rest** (neutral `line` border on raised slate) → **near** (amber border, amber bold text, 8% amber fill on the hero) → **on-clock** (green border, green bold text, 12–14% green fill, plus the animated glow ring on the hero).

### Pick Track

A wrapped row of 14px squares at 3px radius representing every pick in the draft: chip-grey for future, `#4a5566` for completed, pure white for the current pick, green for the user's picks, and green at 55% opacity once one has been used. The single most information-dense element per pixel in the product.

## Do's and Don'ts

### Do:

- **Do** read league shape from settings. Column counts, round counts, and the pick track all derive from `LeagueSettings`; no layout may assume 10, 12, or 16 teams.
- **Do** build translucent state fills with `color-mix(in srgb, var(--color-X) N%, transparent)` at 7–18% with a 45–60% border, never with a new opaque hex.
- **Do** use the `@theme` tokens in `src/app/globals.css` as the single source of color truth; `warRoom.module.css` references them via `var()` and adds no literal colors.
- **Do** give every animation a `prefers-reduced-motion: reduce` escape. Both existing animations have one; a third without one is a regression.
- **Do** pair color with a second cue. Value/Reach carry text, the bye warning carries a `⚠`, the mine state carries a `✓` and a rail width change. Position hue is currently the exception and should not be copied as a pattern.
- **Do** keep hierarchy below 15px in weight and ink rather than size.
- **Do** hold a fixed footprint for optional content — the 52px `min-width` on verdict tags exists so absent verdicts don't ragged the column.
- **Do** gate every hover-revealed control behind a touch equivalent. If a control only appears on `:hover`, it does not exist on a phone.
- **Do** let overflow be an explicit rail — snapping, scrollable, and obviously so — rather than a clipped row or a page that slides sideways.

### Don't:

- **Don't** drift toward the generic SaaS dashboard: 16px airy body text, `rounded-2xl` cards, pastel indigo accents, and whitespace bought with information. Density is the product here.
- **Don't** drift toward platform draft rooms (ESPN/Yahoo house style): heavy chrome, ad slots, logo soup, low information per pixel.
- **Don't** add a filled, saturated primary button. Primary in this system is an outlined sky-tinted button; a solid accent button would out-shout the position hues that carry actual meaning.
- **Don't** introduce a new hue for a decorative purpose. Neutrals and the existing signal set cover non-semantic needs. (The six position hues are themselves open for revision — treat them as inherited, not sacred, but do not accrete alongside them.)
- **Don't** deepen the `--color-rb` / `--color-mine` collision. They share `#3ddc91` by accident; new work should not add meaning to that green until the two are separated.
- **Don't** add a third animated glow. Two exist; urgency animation is the scarcest signal in the system.
- **Don't** make the document scroll. Scrolling belongs to panels.
- **Don't** override `font-variant-numeric: tabular-nums`.
- **Don't** reach for a shadow to separate two app-surface elements. Use a hairline or a tone step — shadows belong to things floating above the app.
- **Don't** modify `prototype/war_room.html`. It is a frozen behavioral and visual reference.
- **Don't** put a feature behind a modifier key without a second path. Cmd/Ctrl-click, Shift-click and right-click are desktop accelerators, never the only way to reach an action.
- **Don't** solve a narrow screen by hiding data. Hide desktop-only *instructions* (modifier-key hints, long prose in the mock bar) and re-seat everything else.
