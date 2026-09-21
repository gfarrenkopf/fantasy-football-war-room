# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a fantasy football manager running their own draft: they are in the draft, on the clock, making the picks. Two usage scenes are equally primary and neither is an adaptation of the other:

- **Second screen.** The draft itself happens in ESPN, Sleeper, Yahoo or similar on one window or one machine; the war room is open beside it. Desktop, dense, read at a glance while a pick timer runs.
- **In the room.** An in-person draft at a table. Phone or tablet only, often the sole screen the user has, held one-handed while talking to eleven other people.

Prep-day use (building the board, rehearsing mocks) is real but secondary to draft day.

Self-hosters are a second audience: they clone the repo, swap in their own player dataset, and run it for their own league.

**The hosted site (`draftroom.online`) has its own audience, and the landing page speaks only to it.** These are people who want to use something, not set something up, and who may pay for a season pass to get the AI-written plan. Two kinds, equally important:

- **The casual manager** who doesn't follow football much and wants to be told who to pick.
- **The power user** running many drafts a season who wants every league in one place, synced, with the draft-day plan on hand for each.

Copy on hosted surfaces never talks about how the product is built (open source, self-hosting, API keys, simulation counts as engineering) — it talks about the draft.

## Product Purpose

Fantasy War Room is an open-source draft room: a tiered board plus a computed plan for what to do with your next pick. It exists because the draft-day tools inside the major platforms tell you who is available but not what to expect — they leave the manager to guess whether a player survives to their next turn, whether a pick is ahead of or behind the market, and whether their bye weeks are quietly colliding.

Success is a manager who, at any moment in a live draft, can look at one screen and know what their next two turns probably look like — and afterward feels the draft went the way they planned rather than the way the clock pushed them.

## Positioning

Two things a neighboring product could not truthfully copy:

1. **The computed turn plan.** Monte Carlo mock drafts run live against CPU drafters with distinct styles, producing per-player survival odds — will he last to my next turn? — which become a concrete plan for this user's specific slot in this specific league shape. 100 simulations drive the live turn plan; 300 drive the deeper availability report. No other draft-day tool does this math while the draft is running.
2. **An AI draft plan written for the user's exact slot** (hosted tier): a plan tailored to their league settings and pick position, not generic advice.

Supporting, not primary: the project is MIT-licensed, self-hostable with no API keys, and descended from a single-file prototype (`prototype/war_room.html`) actually used in a real 2026 draft — every feature exists because it was wanted at the table.

## Operating Context

- **The draft is elsewhere.** The app does not conduct the draft. The user logs picks as they happen on another platform, by hand, under time pressure. Every interaction competes with a pick clock.
- **Divided attention.** The user is simultaneously watching another screen, or talking to people in a room. Nothing may require sustained reading.
- **Session shape:** minutes of setup, then one to three continuous hours of high-frequency logging and scanning, then nothing until next season.
- **Before draft day:** league setup, board review, and repeated mock drafts against the simulator.
- **Terminology in use:** board, tier, ADP, consensus rank (ECR or VOR-derived), Value / Reach, turn plan, availability report, bye conflict, slot, snake, mock, CPU style, FLEX / SUPERFLEX, streaming positions (K, DST).

## Capabilities and Constraints

**Free, and permanently so:** tiered board (Fisher–Jenks tiering), focus view with the live computed turn plan, Value/Reach tags against ADP, mock-draft simulator, availability report, bye-conflict detection, roster slotting, league validation.

**Hosted (paid, once per league per season):** account, league sync across devices, AI-written draft plan (rate-limited per league).

**Constraints future work must respect:**

- **League shape is never hardcoded.** Team count, draft slot, scoring format, and round count (roster length) always come from league settings. There is no canonical 10-, 12-, or 16-team layout to design around; the board and roster panels must hold any of them.
- **Works with zero configuration.** The app boots with no environment variables and no API keys. Hosted features appear only when their credentials exist, so every hosted surface has a credible signed-out / cloud-off state that is not a broken one.
- **Offline-capable by default.** Signed out, all state lives in the browser; there is no network dependency mid-draft.
- **Data is swappable.** Player data is a single validated dataset file self-hosters replace. Copy must not assume a particular provider, season, or scoring format.
- **Player data is not authoritative.** The shipped dataset is clearly labeled sample data. Nothing may present it as live or official.
- **Two pages.** The product is the war room at `/draft` plus, on the hosted site only, a landing page at `/` that is its door; API routes sit behind both. A self-hosted install (cloud features off) sends `/` straight to `/draft`. There is no deeper IA to lean on, and the war room itself remains one route.

**Undecided:** pricing amount; payment flow design.

## Brand Commitments

The user declared nothing binding. Existing facts, recorded as evidence rather than commitment:

- Name in use: **Fantasy War Room**. Production domain: `draftroom.online`.
- Current look: dark-only, dense, tokens ported from the prototype's `:root` block, one CSS module (`warRoom.module.css`) preserving the prototype's class structure. Explicitly open to replacement.
- `prototype/war_room.html` is frozen and never modified; it remains a behavioral reference regardless of any visual change.

## Evidence on Hand

- Working product, pre-alpha: the free draft room is complete and functional.
- The original prototype, used in a real 2026 draft, committed at `prototype/war_room.html`.
- A labeled sample player dataset (`src/lib/data/sample-2026.json`) with ADP, consensus rank, bye weeks, projections, and injury/situation notes.
- Optional SportsDataIO pipeline with a QA gate and one-command rollback (`docs/data-pipeline.md`).
- Deployed on a single droplet with systemd, Caddy, nightly backups, and error-email alerting (`docs/deployment.md`).

**No:** testimonials, named users, user counts, press, case studies, benchmark claims, or accuracy statistics. None exist; none may be invented. Hosted features are not yet shipped and must not be described as available.

## Product Principles

1. **Decide, don't browse.** Every surface exists to answer "what do I do with this pick?" Information that does not move that decision is noise.
2. **Glanceable under a clock.** The user has seconds and divided attention. Density serves speed; nothing important requires reading a paragraph.
3. **Equal on desk and in hand.** Phone and desktop are both the primary case. Neither may be a degraded port of the other.
4. **Honest about uncertainty.** Odds are shown as odds. The product never launders a simulation into a certainty.
5. **The free product is whole.** The board, simulator, availability report, and bye detection are never clipped to sell hosting.

## Accessibility & Inclusion

No formal standard was established. Product-specific needs that follow from the usage scenes:

- Position color (QB/RB/WR/TE/K/DST) is currently a primary carrier of meaning and must never be the only one — the same is true of Value/Reach and bye-conflict signaling.
- Draft rooms happen in dim rooms and in bright ones; contrast must survive both.
- One-handed phone use during an in-person draft implies reachable primary actions and touch targets sized for a hurried thumb.
