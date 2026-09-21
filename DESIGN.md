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
  door-display:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(26px, 3.2vw, 38px)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  door-lead:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(27px, 2.6vw, 36px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  odds:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
rounded:
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "6px"
  xl: "8px"
  dialog: "10px"
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
  entry-panel:
    backgroundColor: "color-mix(in srgb, #22272f 92%, transparent)"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "18px 20px 20px"
    width: "min(446px, 100%)"
  button-door:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
    height: "44px"
  button-door-primary:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.sky}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
    height: "44px"
---

# Design System: Fantasy War Room

## Overview

**Creative North Star: "The Situation Room"**

A dim room with one lit board. The interface sits at rest — near-monochrome, hairline-ruled, almost inert — and escalates only as the user's turn approaches: a border warms to amber, a panel starts breathing on a 1.6s glow, a counter turns from muted grey to alarm. Nothing on this surface is decorative. Every color, every weight change, every pixel of the 13px root type is spent on a fact the user needs while a pick clock runs somewhere else on their desk.

The density is deliberate and it is not an apology. Base font size is 13px, line-height 1.3, numerals tabular everywhere so ranks and ADPs align into readable columns. A player card is a four-column grid 22 pixels tall carrying rank, name, team, bye, position, two ranks, and a Value/Reach verdict. That is the register of a professional instrument, not a consumer app, and the user reading it has seconds and divided attention.

The personality lives entirely in the gap between rest and alarm. Chrome recedes — buttons are 7px-padded panels that barely separate from their background, hover is a tone shift of a few percent, the segmented control's only tell is a slightly lighter fill. Then state arrives and the system commits completely: the mine card takes a 6px green rail, floods 16% green, swaps its rank badge for a checkmark, and turns its name green. There is no middle register, and there should not be.

The system now covers **two surfaces, one world**. `/draft` is the instrument described above. `/` is its door: a landing page that runs a real mock draft of the visitor's own league full-bleed behind one translucent panel holding the entire decision. The door inherits everything — the same ground and panels, the same hairlines, the same six position hues on 3px card rails, the same outlined sky-tinted primary, the same translucent state fills, one shadow and no third animated glow. It departs in exactly three places, each scoped to the route and each recorded as a named exception below: the page scrolls, display type reaches 38px, and survival odds are set at 24px. Nothing else on that page is new vocabulary; where a rule is not exempted by name, it applies.

**Key Characteristics:**
- Dark-only, five stepped surface tones from `#1a1e25` to `#3d4654`, no light mode
- 13px root, tabular numerals, 10px–15px working range; one 56px number as the sole display moment
- Six position hues doing nearly all semantic work, on an otherwise neutral ground
- 1px hairlines instead of shadows; depth by tone, not by lift
- Escalation as the core grammar: rest → warn (amber) → on-clock (green, pulsing)
- Reduced-motion honored on every animation in the system
- Two surfaces: the instrument (`/draft`, 13px, never scrolls) and its door (`/`, 16px, scrolls, display type up to 38px) — the door's exceptions are named and route-scoped, never global

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

Three further roles exist **on the landing route only** (`src/components/landing/landing.module.css`). They are not available to the instrument.

- **Door Display** (700, `clamp(26px, 3.2vw, 38px)`, line-height 1.1, letter-spacing -0.02em): the landing page's section headings — the proof title, the verdicts title, the closing line.
- **Door Lead** (700, `clamp(27px, 2.6vw, 36px)`, line-height 1.08, letter-spacing -0.02em, balanced): the entry panel's two-line promise — "Your draft is in a week." over "Or in twenty minutes." in Terminal Sky.
- **Odds** (700, 24px, line-height 1, letter-spacing -0.02em): the survival percentage on a turn-plan row, inked Value Green / Alert Amber / Dim by band, with a muted 11px `%` beside it.

### Named Rules

**The Weight-Not-Size Rule.** Hierarchy below 15px is built with weight (400 → 600 → 700) and the three-step text ramp, not with size. The working range is 10px–15px and it stays there; a new element that wants to feel important gets weight and ink, not points.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set on `body` and must never be overridden. Ranks, ADPs, pick numbers, and bye weeks are read as columns; proportional digits break the scan.

**The Door Voice Rule** *(route-scoped exception, `/` only).* A door is read across a room; an instrument is read under a clock. The landing page roots at 16px/1.45 and lets headings clamp to 26–38px, above the 10–15px working range the Weight-Not-Size Rule fixes for the app. The exception buys exactly three roles — Door Display, Door Lead and Odds — and buys nothing else: body copy on that page still lives at 11–14px in the same three-step ink ramp. The exception does not travel: a heading above 15px inside `/draft` is a regression, not a precedent.

**The Odds Are The Argument Rule** *(route-scoped exception, `/` only).* 24px/700 is otherwise reserved for exactly one number in the product, the header's pick counter. On the landing page's turn-plan proof, roughly a dozen survival percentages are set at that size on one screen, because those numbers *are* the claim the page is making and the reader is meant to scan them as a column, not hunt them as a signal. This is the one place scarcity is traded for scale, and it is traded knowingly. The odds column is fixed at `min-width: 56px` with tabular figures so a dozen percentages read as a column rather than a dozen ragged strings.

## Layout

The app is a single full-height flex column at `100dvh` with `overflow: hidden` — the page itself never scrolls, only the panels inside it do. A fixed header sits on top; below it, one of two view modes fills the remaining height.

**Board view** is a six-column CSS grid with weighted, uneven tracks: `minmax(250px, 1fr)` for QB, `minmax(290px, 1.12fr)` for RB and WR — the two positions drafted most and needing the most room — `minmax(250px, 1fr)` for TE, `minmax(225px, 0.82fr)` for K/DST, and a fixed `300px` rail. Gap 8px, padding 8px, with `overflow-x: auto` as the only concession to narrow screens. Above it sits a 34px best-available strip.

**Focus view** is a three-column grid, `minmax(280px, 350px) / minmax(0, 1fr) / minmax(280px, 340px)`, gap 10px. At `max-width: 1500px` the side columns fix to 290px and the gap and padding tighten to 8px. Inner grids are self-sizing: target groups at `repeat(auto-fill, minmax(290px, 1fr))`, best-available at 240px, roster slot pickers at 180px.

**Rhythm.** A tight even scale — 3, 4, 6, 8, 10, 14 — applied as: 4px inside a row, 6–8px between controls, 8px between panels, 10–14px inside a hero or dialog. Panel headers are `7px 10px`; player cards `4px 6px 4px 8px`.

**Responsive.** Three bands, and the phone is a designed state rather than a fallback.

- **≥1100px — the full board.** Six weighted columns, the header as one wrapping flex row, hover-revealed controls.
- **768–1099px — the carousel.** The six columns stop fitting, so the board becomes a horizontally snapping track of `46%`-wide pages. The header is unchanged.
- **≤767px — the phone.** The header keeps only what is read under a clock (pick number, turn state, search, roster needs) as a four-row grid; the view switch and every draft action move to a fixed bottom bar in the thumb zone; the board track goes to `88%` pages so the next column peeks; the focus view's three columns flatten (`.fcol { display: contents }`) into one scrolling column re-ordered by decision value, with the pick log last. Picking comes first there: the turn plan / best available accordion, while My roster, Starter byes and Recent picks fold to one tappable summary line each (a stacked bye week shows ⚠ on the folded line). The header's pick box and turn banner are the one statement of the pick number and turn state, in every view — they sit in the pinned header, so they never scroll away — and the phone drops the focus hero instead. Every phone form control is 16px, the size below which iOS zooms the page on focus; pinch zoom stays enabled. A search on the board replaces the carousel with one consensus-ordered list of matches, whose top row is what Enter drafts, and a tap clears it. Modifier-key instructions are hidden, because there are none.

**Touch.** Target sizing switches on `(pointer: coarse), (max-width: 767px)` — either signal earns it, so a touchscreen laptop gets thumb targets without losing its columns, and a phone browser that misreports its pointer still gets them. Rows go to 44px by padding alone; no information is dropped. The `✕` "another team" control leaves `:hover` and becomes permanently visible, because it is the only way to log someone else's pick without a modifier key.

**Safe areas.** `viewport-fit=cover` with `env(safe-area-inset-*)` paid back on the header, the bottom bar, the drawer head and the drawer body.

**The landing route (`/`) is laid out as a document, not as an instrument.** It roots at 16px/1.45 and scrolls normally; the war room's `100dvh` / `overflow: hidden` root is untouched and unshared. The hero is a `100dvh`, `overflow: hidden` band holding three stacked layers: the live board (z 0), the veil (z 1), and — at z 2, anchored from the top at 18vh — **the pair**: the entry panel and the landing clock side by side, centred as one composition with a 28px gap, with the dataset label pinned bottom-right. The sections below it — turn-plan proof, who it's for, verdicts, close, footer — are 1120px-max columns separated by a single top hairline each, at `88px 24px` of padding (`56px 16px` below 640px); the footer runs `48px 24px`. Inner grids are self-sizing: plan columns at `repeat(auto-fit, minmax(260px, 1fr))`, verdict cards at 240px, both gapped 10px. Prose is capped at 54–62ch.

The board layer keeps the app's own density — `font-size: 13px`, `line-height: 1.3`, 8px grid gap and padding, the same 8px panels and 7px 10px column headers — inside a 16px-rooted page. It is the instrument running, not an illustration of it; shrinking it to match the page would make it a picture of the product. It is the war room's board view whole: the 34px best-available strip across the top (the next eight skill players by rank as 999px chips, each re-entering as the room takes the one before it), then the six columns, ordered by tier and then rank exactly as `useBoardColumns()` orders them. Each column is its own hidden scroller that the room moves, never the visitor: as a column's first open player goes, it scrolls smoothly (instantly under reduced motion) to keep that player in view with one struck row of history above. Tier bands are the war room's sticky recessed grooves — siblings of the rows so they can pin — and they count down live, "3 of 8 left", until a drained tier reads "gone" in Dim.

The landing route carries its own three breakpoints, and they are the page's, not the app's (`1100 / 900 / 640` against the app's `1100 / 768 / 767`). At ≥1100px the board runs full-bleed behind the centred pair with a 236px column floor, so its last column bleeds off the right edge — the board continues past the window rather than fitting inside it. At ≤900px the pair stacks, clock first, in a fixed 184px slot above the panel (the pick card replaces the banner inside it, so nothing under a thumb moves when a pick lands), the running team list is dropped, the board goes to three columns and the veil turns vertical. At ≤640px the board drops to two columns, the panel goes full width, and the email row stacks.

Anything that must overflow does so as a named, snapping or scrolling rail — the action bar, needs strip, mock bar, best-available strip, board track. The document itself never scrolls sideways at any width.

### Named Rules

**The Page Never Scrolls Rule.** The root is `100dvh` / `overflow: hidden`. Scrolling belongs to individual panels via `.scroll`, so the header, strip, and column titles stay fixed while a 200-player list moves under them. A new surface that makes the document itself scroll has broken the instrument.

**The Door Scrolls Rule** *(route-scoped exception, `/` only).* The Page Never Scrolls Rule governs the instrument, not its door. The landing page is a normal scrolling document — hero, proof, verdicts, close, footer — because a visitor who has not yet decided anything is reading, not operating. The exception is confined to `/`: `/draft` and every surface inside it keep the `100dvh` / `overflow: hidden` root, and the landing page never imports or relaxes it.

**The Weighted Column Rule.** Board columns are sized by how much the position is drafted, not equally. RB and WR get 1.12fr and a 290px floor; K/DST get 0.82fr and 225px. Equal columns would be tidier and worse.

**The Same Board Rule.** Narrow screens re-seat the information architecture; they never reduce it. The phone shows the same six position groups, the same tiers, the same Value/Reach verdicts and the same bye warnings as the 1440px board — as pages you swipe rather than columns you scan. A mobile layout that drops a position, a column, or a verdict has answered the wrong question.

**The Reachable Action Rule.** Below 767px, every control the user touches mid-draft lives in the fixed bottom bar, ordered by how often a thumb needs it: Undo, Turn plan, then the rest, with the destructive Reset last in the rail. Nothing the draft depends on sits in the top-right corner of a phone.

## Elevation & Depth

Depth in this system is **tonal, not cast**. Five stepped surface values (`#1a1e25` ground → `#1f242c` recessed tier band → `#22272f` panel → `#282e37` raised control → `#3d4654` bright hairline) plus 1px borders do all the structural work. The app surface itself carries no shadow at any elevation.

Shadows appear in exactly three places, all of them things floating *above* the app: the drawer (`-10px 0 30px rgb(0 0 0 / 0.4)`, cast sideways from the right edge), and modal dialogs and the availability report (`0 20px 60px rgb(0 0 0 / 0.5)`), over a `rgb(0 0 0 / 0.35)` scrim.

The one thing the app surface *does* get is **ring-glow as urgency**: `box-shadow: 0 0 0 3px <color-mix>` animated on an alternating 1.2s–1.6s ease-in-out cycle, amber for an urgent roster need and green for on-clock. This is the only animated elevation in the product and both instances are disabled under `prefers-reduced-motion`.

The landing route adds no new depth vocabulary. Its entry panel takes the documented Overlay lift and nothing else — it is **the one lift on that page** — reinforced by a 92%-opaque panel fill over `backdrop-filter: blur(10px)`, so the board stays visibly present through it rather than being hidden behind it. Separation from the board is otherwise done with light, not shadow: **the veil**, a two-layer non-interactive scrim at z 1 — an elliptical pool of ground behind the centred pair (72% at the centre, 52% at the edges) over a top-and-bottom fade — so the board reads evenly on both sides of the pair and never competes with it (rotated to a vertical fade below 900px, where the pair stacks). Dim room, one lit board — the North Star made literal. There is still no third animated glow: the landing page has none at all.

**Status: this flatness is inherited from the prototype, not chosen.** The user has explicitly marked it open for revision. Treat the current vocabulary as the documented baseline, not an invariant — a future pass may legitimately introduce depth, and should do so deliberately rather than by accretion.

### Shadow Vocabulary

- **Drawer cast** (`box-shadow: -10px 0 30px rgb(0 0 0 / 0.4)`): the right-edge drawer only, directional so the panel reads as sliding over the board.
- **Overlay lift** (`box-shadow: 0 20px 60px rgb(0 0 0 / 0.5)`): modal dialogs and the availability report, always paired with the scrim — and the landing page's entry panel, which earns it by genuinely floating over a running board.
- **Urgency ring** (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warn|mine) 35–45%, transparent)`, animated): on-clock hero and urgent needs pill. Never static, never decorative.

### Named Rules

**The Glow-Means-Now Rule.** An animated ring means "this concerns your very next action." It is the scarcest signal in the system — two instances product-wide — and adding a third without removing one devalues both. On a phone the on-clock glow moves from the (hidden) hero to the header's turn banner; it is still one on-clock glow, not a second.

## Shapes

A restrained, mostly-square form language on a tight radius ladder: **2px** (position dots), **3px** (bye pills, track squares, micro badges), **4px** (rank badges, verdict tags, small buttons), **6px** (buttons, inputs, segmented controls, the turn box — the system's default), **8px** (panels, columns, heroes), **10px** (drawers, dialogs, and the landing entry panel — the things that float), **999px** (best-available chips only), and **50%** (the 7px injury-note dot).

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

### Pick Card — your pick

The one celebration in the product, for the one moment it builds to: a pick the user logs as their own by hand (never simulated picks, never a player moved between rosters). It replaces the toast for that case.

- **Form:** floats above the app, so it takes the overlay lift and the 10px dialog radius; 400px wide, bottom-centered, above the phone's action bar. Panel fill lit from the top with a 16% mine-green wash and a 55% mine border.
- **Content:** the mine ✓ badge at 32px, the player name at 20px/700 (the card's display moment), position flag, team, positional rank and bye, the overall pick number at 24px with round.pick, the roster slot he starts at ("RB2", "FLEX", bench), the Value/Reach verdict when there is one, and the next turn — "You're still up: pick N" in green on back-to-back picks.
- **Bye clash:** carried inside the card as an amber callout, with the border and wash turning amber, so the warning can't hide behind the celebration.
- **Motion:** a 520ms arrival (rise, un-blur, settle), one pass of light across it, the ✓ stamped in; a 2px hairline at its foot shrinks over its life (1.8s back-to-back, 2.6s normal, 4.2s with a clash). No scrim, no focus trap; a tap dismisses. Reduced motion: a fade, no sweep, no stamp.

**On-clock arrival.** When a logged pick puts the user on the clock, the turn banner (and the desktop hero's state block) takes one pass of green light and the header's pick number pops in green; the tab title reads "● Pick N: you're on the clock" for the second-screen user. Not on load, not on undo, not during a full auto mock.

### Entry Panel — the landing signature (`/` only)

The door's whole decision in one floating card: brand row, thesis, sub-line, the compact league setup, the outlined primary, then a hairline and the sign-in block.

- **Form:** `min(446px, 100%)` wide, `18px 20px 20px` padding, 10px radius, `line2` border (one step brighter than a panel, because it is off the board), 92%-opaque panel fill over `backdrop-filter: blur(10px)`, Overlay lift.
- **Controls:** the setup group is a recessed `strip`-ground box at 8px radius with an 11px uppercase letter-spaced header; fields are a two-column grid with a full-width span for scoring. Selects and inputs are the app's input at **16px** — the size below which iOS zooms on focus — rather than the app's 12.5px.
- **Buttons:** the app's button at door scale — `10px 14px`, 14px/600, `min-height: 44px`, 6px radius. Primary is the same outlined sky-tinted voice (`sky-line` border, `sky` text), with a 10% sky wash into `panel2` on hover. No filled accent button appears anywhere on the page.
- **A setting the data decides** wears no input chrome at all: when the loaded dataset supports one scoring format, the picker is replaced by a plain bold value plus an 11px dim explanation. A bordered, filled box beside two live selects would read as a control the visitor had broken.
- **Motion:** a 560ms arrival (rise 18px, un-blur 4px, settle from 0.98) followed by one pass of sky-tinted light across it — the pick card's `sweep`, borrowed once. Board cards arrive on the same 520ms curve, staggered 22ms each and capped at 620ms. Everything uses the app's expo-out easing `cubic-bezier(0.16, 1, 0.3, 1)`. Under `prefers-reduced-motion: reduce` the panel, cards and confirmation lose their animations and the sweep is removed entirely.
- **Signature interaction:** editing teams, slot or scoring re-deals the board behind the panel (the board is keyed by league shape, so every card replays its entrance), and a polite live region states the re-seat in words for a reader who cannot see it. The board itself is `aria-hidden`; the sections below carry the same claims as text.

### Turn-Plan Proof Row (`/` only)

Three `auto-fit` columns — "Plan on these" / "If they're gone" / "Don't count on it" — built from the app's panel (8px, `panel` fill, hairline), each tinted only at the border via `color-mix` against `line` (Value Green 40%, Alert Amber 34%, neutral). Rows carry the board's own 3px position rail and `row-line` divider; the name sits at 13.5px/600 over an 11px muted meta line, and the survival number right-aligns in the fixed 56px odds column at the Odds role, inked to match its band.

### Landing Clock (`/` only)

The landing hero's second object, beside the entry panel and over the lit half of the board: the war room's turn banner and pick card, counting the landing mock down to the visitor's slot. The banner (opaque `panel`, 10px, `line2` hairline) carries a muted 11px label naming it a mock and the league shape, the pick number at 22px/700 with its round.pick label, the turn state right-aligned, and one 6px square per team in the round — done, now, and the visitor's (outlined green, filled once used). It escalates in the war room's grammar and no other: rest (muted) → near, two picks out (amber border and 8% fill) → on the clock (green border, 12% fill, one sweep of light). When the simulator makes the visitor's pick, the war room's pick card lands under the banner — ✓ stamped in, the name at 22px, one sweep, the 2px life hairline running out over the 3.4s the room holds — and its foot says what only this product can at that moment: who should still be there when the snake comes back, and at what odds, from the same 100 mocks as the proof section. The card then settles into a running "Your team" list on desktop. On a phone the clock takes a fixed 184px slot above the panel, with the card replacing the banner inside it, so nothing under the thumb moves when a pick lands.

The room is paced like a draft feels, not like a clock: picks far from the visitor's go by at 560ms, slow to 950ms and 1.4s as the turn approaches, hold 1.9s on the clock and 3.4s after the pick lands. Only the reveal is timed; every pick is the simulator's. A hidden tab stops the room. Under reduced motion the room does not tick at all: it opens with the visitor's first pick already made.

**The Clock Adds No Glow.** The landing clock uses translucent fills and single, non-repeating sweeps. It never pulses and never rings: the product's two animated glows both belong to `/draft`.

### Opening Night (`/draft`, once per new league)

The first time a league opens — straight from the landing page's "Open the war room", `?new=1` — the war room goes dark and announces the draft like a broadcast, then gets out of the way. Beats, from the lights going down: two follow-spots sweep the stage from the wings (250ms on); "THE {season}" rises in Terminal Sky and "DRAFT" slams onto the stage from 2.8× scale and blur, and the stage shakes on impact; the league's name follows with "welcome to the war room"; its shape counts onto the board as three tabular numbers — teams, rounds, picks — from the league's own settings; at 2.75s the visitor's slot is called on a skewed Signal Green slab wiped in left to right — "YOU PICK 6TH", or "YOU'RE ON THE CLOCK" from slot 1 — while confetti fires from both bottom corners in the six position hues and amber, and phones that can buzz; then "The clock is running.", the picks until their turn, one line of what to do first, and a filled green "LET'S DRAFT →". At 6.2s, or on the button, any key, a tap after the title, or "Skip", the whole stage irises down (`clip-path: circle()`) onto the header's pick box — the clock it just started is that one. It never runs again for that league. Reduced motion gets the same announcement as a still card, dismissed by the button.

The display face is **Big Shoulders** (SIL OFL 1.1, weights 700–900), committed at `src/components/draft/fonts/` and loaded with `next/font/local` so no build ever needs the network. It sizes by the viewport's shorter side (`min(30vw, 24vh)` for "DRAFT") so the whole stage fits a laptop screen and a phone alike.

**The Opening Night Exception.** This overlay is the one place the product deliberately breaks its own muted grammar: a second typeface, a filled saturated slab and button, a text halo, stage lighting, screen shake and confetti. The exception is scoped to this overlay and this moment — the start of a draft someone has waited a season for — and it buys nothing anywhere else. Every number on it is the league's own; it is shown once per new league, and it is always skippable.

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
- **Do** inherit the whole world on a new surface and depart by exception only. The landing page takes three exceptions — it scrolls, it clamps headings to 38px, it sets odds at 24px — each named, each justified by that surface's job, each written down here. Anything not exempted by name still applies.
- **Do** give each CSS module its own `cx()` helper bound to that module. `src/components/landing/cx.ts` exists because the draft's `cx()` is bound to `warRoom.module.css` and would silently drop every class name from another stylesheet.
- **Do** keep an embedded instrument at its own density. The landing board stays at 13px inside a 16px page, because it is the product running, not a screenshot of it.
- **Do** raise form controls to 16px on any surface a phone will type into — on the landing page that is every select and input, not just the ones below 767px.
- **Do** let overflow be an explicit rail — snapping, scrollable, and obviously so — rather than a clipped row or a page that slides sideways.

### Don't:

- **Don't** drift toward the generic SaaS dashboard: 16px airy body text, `rounded-2xl` cards, pastel indigo accents, and whitespace bought with information. Density is the product here.
- **Don't** drift toward platform draft rooms (ESPN/Yahoo house style): heavy chrome, ad slots, logo soup, low information per pixel.
- **Don't** add a filled, saturated primary button. Primary in this system is an outlined sky-tinted button; a solid accent button would out-shout the position hues that carry actual meaning.
- **Don't** introduce a new hue for a decorative purpose. Neutrals and the existing signal set cover non-semantic needs. (The six position hues are themselves open for revision — treat them as inherited, not sacred, but do not accrete alongside them.)
- **Don't** deepen the `--color-rb` / `--color-mine` collision. They share `#3ddc91` by accident; new work should not add meaning to that green until the two are separated.
- **Don't** add a third animated glow. Two exist; urgency animation is the scarcest signal in the system.
- **Don't** make the document scroll inside `/draft`. Scrolling belongs to panels. The landing route is the one exception and it does not generalize.
- **Don't** carry the door's type scale into the instrument. 26–38px headings and 24px odds are licensed on `/` and nowhere else; inside the war room the working range is still 10–15px.
- **Don't** add a second lift to the landing page. The entry panel takes the Overlay lift because it floats over a live board; everything else there is separated by hairline, tone, or the veil.
- **Don't** override `font-variant-numeric: tabular-nums`.
- **Don't** reach for a shadow to separate two app-surface elements. Use a hairline or a tone step — shadows belong to things floating above the app.
- **Don't** modify `prototype/war_room.html`. It is a frozen behavioral and visual reference.
- **Don't** put a feature behind a modifier key without a second path. Cmd/Ctrl-click, Shift-click and right-click are desktop accelerators, never the only way to reach an action.
- **Don't** solve a narrow screen by hiding data. Hide desktop-only *instructions* (modifier-key hints, long prose in the mock bar) and re-seat everything else.
