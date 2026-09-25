# In-season: lineups and trades

War Room's second product: help with ESPN leagues after the draft. Signed-in users connect a league once and get a free optimal lineup every week and a roster-aware trade verdict. The season pass adds AI-written lineups and trade write-ups. It's hosted-only (`cloudEnabled`), and ESPN-only for now.

The plan was settled on 2026-09-24. The tickets are Epic 10 (free foundation, APE-174), Epic 11 (paid AI, APE-183) and Epic 12 (lineup write-back, APE-184). The ESPN facts behind it are in [espn-protocol.md §8](espn-protocol.md#8-in-season-reads-and-lineup-writes).

## Contents

1. [What carries over from the draft room](#1-what-carries-over-from-the-draft-room)
2. [Data](#2-data)
3. [Connecting a league](#3-connecting-a-league)
4. [Lineups](#4-lineups)
5. [Trades](#5-trades)
6. [Free and paid](#6-free-and-paid)
7. [Writing lineups to ESPN](#7-writing-lineups-to-espn)
8. [Open questions](#8-open-questions)

---

## 1. What carries over from the draft room

Little of the draft engine. Snake math, the Monte Carlo simulator and availability odds only make sense before a draft. What carries over is the plumbing: ESPN league import (`espn/league.ts`), roster slotting (`roster.ts`), `LeagueSettings`, accounts and sync, `secretBox`, entitlements and checkout, and the AI plan pipeline (`src/lib/ai/`).

In-season lives at its own route, `/season/[leagueId]`, with its own light provider tree. The draft room stays as it is. The two link both ways: the draft room's Season button opens the league's season page, and the season page's "Draft room" link opens `/draft?league=<id>`, which switches the draft room to that league. When the user follows more than one ESPN league, the season page's title is a menu of them (APE-194).

## 2. Data

ESPN's own projections, behind a `ProjectionSource` interface so a paid source (SportsDataIO) can replace them later.

- **Weekly projections for every remaining week** come from ESPN's public `kona_player_info` view, with no cookies, for the whole player pool at once. That makes one fetch cacheable across every league.
- **League scoring is computed, not fetched.** The public rows carry raw stats. Σ stat × `scoringItems.points` (with `pointsOverrides` by lineup slot) reproduces ESPN's league-scored `appliedTotal` exactly.
- **Rest of season (ROS)** is the sum of weekly projections from the current week through the league's `finalScoringPeriod`, with bye weeks projected as 0 by ESPN. ESPN's split-2 season row is unexplained and not used.
- Injury status comes from roster entries and `kona_player_info`.

## 3. Connecting a league

The bookmarklet, clicked once on an ESPN league page, reads `espn_s2` and `SWID` from `document.cookie` (neither is `HttpOnly`) and hands them to War Room together with `mSettings`, after a consent screen.

- The credential is stored **per user**, sealed with `secretBox`, because one ESPN login covers all of a user's leagues.
- There's no fixed expiry. A 401 or 403 from ESPN marks the credential disconnected and asks for one more bookmarklet click.
- The credential is hard-deleted on disconnect, on account deletion, and after the fantasy season ends.
- **A finished draft comes onto the board (APE-193).** A league connected after its draft would otherwise open in the draft room on an empty board, and premiere as a draft still to come. Connecting reads `mDraftDetail` too, and when ESPN's draft is finished, its picks fill the league's board through the same crosswalk live sync uses. Leagues connected before this get it on their next season page load (`backfillEspnDraft()`, run with `after()`). It only ever fills an empty board, and only when ESPN's pick count matches the board's teams × rounds. The draft room's Final Whistle doesn't play for a draft that arrives finished all at once.
- ESPN is the source of truth for rosters. The server re-reads `mRoster` + `mTeam` for every team, with a cache measured in minutes.

## 4. Lineups

The **optimal lineup** is the best legal starting lineup for the current week from weekly projections. It honours the league's slots, FLEX/SUPERFLEX eligibility, lock state (`lineupLocked`) and injuries. The page shows it as a diff against the lineup set on ESPN.

## 5. Trades

The trade verdict is a **roster delta**, not a sum of player values. For each team, it takes the best legal starting lineup's ROS points before and after the trade and reports the change, broken down by slot. This scores 2-for-1 consolidation and positional holes correctly. Uneven trades assume the lowest-value bench player is dropped.

Launch is build-a-trade: pick a partner and players from both sides. Importing pending ESPN offers comes next, and trade suggestions come in a later epic.

## 6. Free and paid

| | Free | Trial / season pass |
|---|---|---|
| Optimal lineup, trade verdict | Always | Always |
| AI lineup | No | Mid-week, plus Sunday morning after inactives |
| AI trade write-up | No | Unlimited |

- **Trial:** 5 NFL weeks per account, counted from first use, with week boundaries from ESPN's `scoringPeriodId`. Enforcement is described in [payments.md §5](payments.md#in-season-ai).
- **Season pass:** the same per-league, per-season pass as the draft plan. Existing passes include in-season.
- **The Sunday AI lineup** is generated by a timer at 11:40 ET, after the inactives for 1pm games. It's emailed, and it skips users who haven't opened the season page in two weeks.

### The AI outputs (11.2)

Both extend the draft plan's pipeline (`src/lib/ai/`): the same provider seam, structured output against a JSON schema, validation that never trusts the model, and a row in `ai_generations` for every call (`purpose` is `season-lineup` or `season-trade`, so `npm run ai:costs` splits them). The model explains the engine's numbers and answers with refs; everything it says must come from the tables it was given.

- **AI lineup** (`src/lib/ai/season/lineup.ts`): the input is the optimal lineup, each slot's **close calls** (bench players within `CLOSE_POINTS`, 2 projected points, of the starter, never one ruled out or locked), injury designations, byes and lock state. The model writes a reason for every slot that's a close call or a move on ESPN, and may start any of a close call's options. Everywhere else the engine's pick stands. A ref that isn't in the input rejects the response; a start outside the options, or a player started twice, falls back to the engine's pick.
- **AI trade write-up** (`src/lib/ai/season/trade.ts`): the input is the trade verdict for both teams, recomputed on the server, plus both rosters with rest-of-season points, playoff-week points (from `playoffStartWeek`, parsed from ESPN's schedule) and remaining byes. The output is an accept/decline/counter lean, a summary, 2–4 reasons, and a counter-offer by ref when one is obvious. A counter with players on the wrong side is dropped.
- **Stored, never re-billed** (`season_ai_outputs`): lineups per league, week and kind; write-ups per league, week and trade. A lineup that fails gives the week's allowance back. Either way the free result still shows.
- **Routes:** `POST /api/leagues/:id/season/lineup` writes this week's mid-week lineup, and `POST /api/leagues/:id/season/trade { partner, gives, gets }` a write-up. Both answer 402 past the trial without a pass, and 503 when the model fails.
- ESPN's league reads carry no NFL opponent, so the AI sees no matchups yet. It's told not to guess them.

### The Sunday job (11.3)

`runSundayJob()` (`src/lib/server/seasonSunday.ts`), started at 11:40 ET on Sundays by a timer on the droplet ([deployment.md §13](deployment.md#13-sunday-ai-lineups)):

- **Who:** every connected league whose user opened its season page in the last 14 days (`espn_season_links.last_viewed_at`, set on each page load). Opening the page again re-enrols it. Of those, only leagues with a season pass, or whose account is in a trial it has already started: the job never starts a trial.
- **What:** it re-reads ESPN and the projections (skipping the caches), then writes the league's `lineup-sunday` AI lineup through the same path as the mid-week one (11.2).
- **Email:** one per user covering all their leagues, with each league's projected gain and top three moves, through Resend. A user whose ESPN login has lapsed gets a reconnect email instead. `season_emails` holds one row per user, kind and day, so a rerun never sends twice. Users opt out on the season page, or with the email's link (`/season/unsubscribe`, signed with `NEXTAUTH_SECRET`; mail providers get RFC 8058 one-click unsubscribe too). Opting out stops the emails, not the lineups.
- **Failures** are logged as `[server-error]` lines, so the alert emails pick them up.
- **Only one automatic run.** News before the 4pm, SNF or MNF games comes after it; the user can still use their mid-week lineup if it's unused, or the free lineup.

### The early-kickoff alert (11.4)

The Sunday job comes too late for players whose games kick off first: they're locked by 11:40. `runEarlyJob()` (`src/lib/server/seasonEarly.ts`) covers them, for free, with no AI:

- **Which games:** every kickoff before the week's Sunday job, from ESPN's public `proTeamSchedules_wl` view (`src/lib/season/schedule.ts`). The week's main slot is the one with the most games, so no weekday is assumed. In 2026 that means Thursday nights, the Sunday 9:30 AM London games (weeks 4 and 5), Saturday games in week 15, and Christmas Friday in week 16. A game whose time is still TBD is left out until ESPN sets one.
- **When:** a timer every 15 minutes. The job acts only when an early kickoff is 60–75 minutes away, after the inactives (~90 minutes before).
- **What:** for each league opened in the last 14 days, it re-reads ESPN and takes the free optimal lineup's changes that involve an unlocked player in that game, going in or out. Changes among Sunday players wait for Sunday.
- **Email:** one per user and kickoff, listing each league's changes. It honours the same opt-out. A lapsed ESPN login is left to the Sunday job's reconnect email.

## 7. Writing lineups to ESPN

Advice is the default. Applying a lineup to ESPN is an option (Epic 12, 12.1), in the lineup tab's move list. The user stages a lineup (War Room's, ESPN's own, or either edited by hand with a picker per starting slot), and War Room sends the moves as **one** transaction, which ESPN applies atomically. After an apply the editor starts again from ESPN's new lineup, so the user can keep managing their team from War Room.

- **Pure checks** (`src/lib/season/apply.ts`), run in the browser while staging and again on the server: every move is the user's own player, where ESPN has them, unlocked, into a slot they're eligible for, and the result fits the league's starting slots and bench. Players on IR are left alone.
- **Route:** `POST /api/leagues/:id/season/apply { week, snapshot, moves, consentVersion? }` (`src/lib/server/espn/applyLineup.ts`, `lineupWriter.ts`). The team is the user's own, from their season link; the request never names one.

Guardrails:

1. The user reviews every move and confirms. Nothing is applied automatically: the Sunday job and the AI never write.
2. Re-read the roster (skipping the cache) right before writing. Abort if ESPN has moved on a week, if anything on the roster changed since staging (`snapshot`), or if the checks fail against the fresh roster (a player now locked). ESPN doesn't check `fromLineupSlotId`, and it has no dry run, so this check is ours to make.
3. Re-read after writing, even when the write timed out, and show which moves landed. ESPN refusing, a failed write, a move that didn't land, and a write that couldn't be checked all log `[server-error]`.
4. A separate, versioned consent line (`ESPN_LINEUP_WRITE_VERSION` in `src/lib/espn/disclosure.ts`, stored in `user_prefs.lineup_write_consent`), asked the first time the user applies.

## 8. Open questions

- **Do future-week projections update week to week?** Compare a stored week-17 projection against a later read.
- **What shape does `mPendingTransactions` take** when a trade is pending? This is needed for importing offers.
