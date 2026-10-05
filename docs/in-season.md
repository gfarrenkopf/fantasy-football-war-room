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
- **News and ownership** come from the same roster read (APE-213). The page shows ESPN's written outlook for the week (`outlooks.outlooksByWeek[week]`) only for the user's own players whose `lastNewsDate` is under a day old. ESPN writes an outlook for nearly everyone, so without that filter every player would carry the tag. `ownership.percentOwned` / `percentStarted` show on the bench and in the trade builder.
- **Standings and the trade deadline** (APE-214): each team's `record.overall` and `playoffSeed` come from `mTeam`, and the deadline from `mSettings` `tradeSettings.deadlineDate`, all already in the page's read. The AI trade write-up gets both teams' records, points for and seeds (prompt version 2).
- **This week's matchup** (APE-211) comes from `mMatchupScore` in the page's read: both sides' points, ESPN's projection for the lineups set on ESPN, and ESPN's win probability. Each player's NFL opponent and kickoff come from the same public scoreboard as game state.
- **Points scored this week** come from the roster read itself. Each player's actual row for the current week (`statSourceId 0`, `statSplitTypeId 1`) carries `appliedTotal` in the league's own scoring. **Where each game stands** (not started, under way, or final, with ESPN's clock line) comes from ESPN's public NFL scoreboard, cached for a minute. If the scoreboard fails, the points still show, without a game status. The page updates on load and on Refresh (APE-196).
- **Game day** (APE-226): while any of the user's players (bench included, IR not) is in a game, the first tab becomes "Game day". Once all of them are final it shows the week's result, until 6 AM Eastern on the Tuesday after the week's last game. Between game windows it stays on the lineup. While a game on either side of the matchup is under way, the page reloads its data every minute when the tab is visible, and the server reads the league again once its cached copy is 45 seconds old (3 minutes otherwise). The phase logic is `src/lib/season/gameday.ts`.
- **ESPN's call** (APE-229): every read of a league (the season page, after it's sent; the Sunday 11:40 ET job; the early-kickoff job) records ESPN's projections in `season_projections`: each of the user's players and both matchup teams. A player's projection follows ESPN until kickoff and is then frozen. A team's is the sum of its starters' projections, not ESPN's matchup projection, which folds in the points already scored as games finish; the points scored are filled in once the game (for a team, every starter on both sides) is final, and keep updating with ESPN's stat corrections. Game day shows both teams' pre-game projections against their scores, the players who most beat and missed theirs, and ESPN's average miss on the user's team over earlier weeks. Once the matchup is final, the result card also tells how it swung (APE-243, `src/lib/season/swing.ts`): ESPN's pre-game margin, the biggest swings against projection on both sides, and the final. It adds starters who were projected for nothing, and the best lineup in hindsight.
- **The week's result** (APE-230): once every starter on both sides is final, game day replaces the scoreboard with the result: a win opens Win Night, a full-screen show on the draft room's stage with a shareable win card, once per league and week on a device (a device pref in `src/lib/storage/moments.ts`); a loss shows a quiet panel.

## 3. Connecting a league

The bookmarklet, clicked once on an ESPN league page, reads `espn_s2` and `SWID` from `document.cookie` (neither is `HttpOnly`) and hands them to War Room together with `mSettings`, after a consent screen.

- The credential is stored **per user**, sealed with `secretBox`, because one ESPN login covers all of a user's leagues.
- There's no fixed expiry. A 401 or 403 from ESPN is confirmed with a second, light read of the same league (`mSettings`, `sessionCheck.ts`). Only if ESPN refuses that too is the credential marked disconnected, which asks for one more bookmarklet click. One login covers every league, so a refusal ESPN doesn't repeat is treated as a failed read (served stale or unavailable), or, on a write, as ESPN refusing that change (APE-244).
- The credential is hard-deleted on disconnect, on account deletion, and after the fantasy season ends.
- **A finished draft comes onto the board (APE-193).** A league connected after its draft would otherwise open in the draft room on an empty board, and premiere as a draft still to come. Connecting reads `mDraftDetail` too, and when ESPN's draft is finished, its picks fill the league's board through the same crosswalk live sync uses. Leagues connected before this get it on their next season page load (`backfillEspnDraft()`, run with `after()`). It only ever fills an empty board, and only when ESPN's pick count matches the board's teams × rounds. The draft room's Final Whistle doesn't play for a draft that arrives finished all at once.
- ESPN is the source of truth for rosters. The server re-reads `mRoster` + `mTeam` for every team, with a cache measured in minutes.

## 4. Lineups

The **optimal lineup** is the best legal starting lineup for the current week from weekly projections. It honours the league's slots, FLEX/SUPERFLEX eligibility, lock state (`lineupLocked`) and injuries. The page shows it as a diff against the lineup set on ESPN.

## 5. Trades

The trade verdict is a **roster delta**, not a sum of player values. For each team, it takes the best legal starting lineup's ROS points before and after the trade and reports the change, broken down by slot. This scores 2-for-1 consolidation and positional holes correctly. Uneven trades assume the lowest-value bench player is dropped.

Launch is build-a-trade: pick a partner and players from both sides. Pending ESPN offers are imported and graded too (10.9), and trade ideas (below) suggest trades to offer.

**Trading on ESPN (13.5).** Pending offers to the user have **Accept** and **Decline**, and the user's own have **Withdraw**. The builder's trade can be sent as an offer (**Offer this on ESPN**), with the verdict's drops as `DROP` items when the user would be over the roster limit. `POST /api/leagues/:id/season/trades` (`src/lib/server/espn/trades.ts`) goes through the same guardrails as lineup writes (§7). The pure checks (`src/lib/season/tradeWrite.ts`) cover the deadline, players already in a trade (`tradeLocked`), players who've moved since the page loaded, the user's roster limit, and that only the team an offer was made to answers it. An accepted trade stays in Pending, marked Accepted, through the league's review. ESPN's own page asks for the password again before an accept; its API doesn't, so War Room accepts with the stored login.

### Trade ideas (APE-222)

Paid (§6): two trades a week the user could offer, found by searching every roster in the league. The engine picks the trades and their numbers; the AI picks one of each kind from the engine's shortlist and writes them up.

- **The search** (`src/lib/season/tradeIdeas.ts`) is pure and grades the way the verdict does: each team's best starting lineup over the rest of the season, before and after, with the same roster cut. Every 1-for-1 to 2-for-2 is millions of trades in a 16-team league, so it narrows first:
  1. The user's 10 best players by rest-of-season points are on offer.
  2. Against each partner, each player is valued alone: what he adds to the receiving lineup less what losing him costs the sender.
  3. The best six on each side go into every 1-for-1 to 2-for-2 combination, and each combination is graded exactly.
  - Lineups are solved greedily (`lineupTotal()`). That's exact here, because each flex slot takes a superset of the narrower slots' positions, and a test checks it against the assignment solver. Every solve counts against a budget of 20,000 (`DEFAULT_LIMITS`), and the search stops there. A seeded 16-team league takes about 9,500 solves, roughly 0.3 s.
- **Two kinds:**
  - **Safe:** the user gains at least 0.05 a week and the partner loses nothing.
  - **Bold:** the partner loses less than 0.5 a week, and the user gains more than with any safe idea.
  - Each kind keeps up to four, at most two per partner. A trade that only pads a simpler one with the same partner, for about the same result, is dropped.
- **Excluded players:** anyone `tradeLocked`, on IR, or already in a pending trade, and unprojected players the user would get. There's no search after the deadline.
- **The AI write-up** (`src/lib/ai/season/tradeIdeas.ts`, prompt version 1) gets the shortlist with both sides' grades, the user's roster and the players they'd get. It picks one id per kind and writes a "why" for the user and a short note to the partner. The note is copied by hand: ESPN's `TRADE_PROPOSAL` has no message field. A pick that isn't a candidate rejects the response, so the model can't invent a trade or change its numbers.
- **On the page,** the ideas sit above Pending on the Trades tab. Each one is graded again live (`ideaStatus()`):
  - **Stale:** a player has left that roster.
  - **Blocked:** a player is now in another trade.
  - **Offered:** the user already sent it.
  - **Load into builder** opens an idea in the builder. **Offer on ESPN** sends it through the same propose path as the builder (13.5).

### Waiver pickups (APE-212)

The Waivers tab ranks available players the way trades are scored. It adds each player to the user's roster, cuts the weakest player by rest-of-season points, and measures the change in the best starting lineup's points over every remaining week (`src/lib/season/waivers.ts`). A player who would only sit on the bench scores nothing.

- **The pool** is the 100 most-rostered FREEAGENT / WAIVERS players at the positions War Room plays. It comes from a league-scoped `kona_player_info` read with an `X-Fantasy-Filter`, made with the user's login when the tab opens (`GET /api/leagues/:id/season/waivers`), and cached for ten minutes. Projections come from the same public source as rosters.
- **The top ten** gains of at least 0.05 points a week are shown, each with who to drop, and whether the player is a free agent or on waivers and when he clears.
- **The user's waiver priority** (`mTeam` `waiverRank`) is shown, or FAAB left in a league that bids (`acquisitionSettings.acquisitionBudget` minus `transactionCounter.acquisitionBudgetSpent`).
- **Adding a free agent (13.3):** a free agent's row has **Add**. The user picks who to drop (War Room's suggestion first, or no one when the roster has room), reviews, and confirms. `POST /api/leagues/:id/season/acquire { kind: "add", week, snapshot, add, drop }` (`src/lib/server/espn/acquire.ts`) sends one `FREEAGENT` transaction through the same guardrails as lineup writes (§7). The pure checks (`src/lib/season/acquire.ts`) cover the roster limit (starting slots plus bench, IR not counted), a locked or missing drop, and a player another team has picked up since the pool was read. Whether the player is still a free agent is ESPN's call: it refuses one on waivers, and the whole transaction with him. The pool's cache is dropped after an add.
- **Waiver claims (13.4):** a player still on waivers has **Claim**, with the same drop picker. `{ kind: "claim", … }` on the same route sends one `WAIVER` transaction. The drop only happens if the claim succeeds. The claim has landed when the re-read shows it pending. The user's pending claims (`mPendingTransactions`, parsed by `parsePendingClaims()`; ESPN only shows the reader their own) are listed at the top of the tab, named from the projections feed, each with **Cancel** (`{ kind: "cancel", week, claimId }`, a `CANCEL` of the claim). Leagues that bid FAAB aren't supported yet: there the tab shows no **Claim**, and the server refuses one. Claims happen on ESPN.

## 6. Free and paid

| | Free | Trial / season pass |
|---|---|---|
| Optimal lineup, trade verdict, waiver pickups | Always | Always |
| AI lineup | No | Mid-week, plus Sunday morning after inactives |
| AI trade write-up | No | Unlimited |
| Trade ideas (APE-222) | No | Two a week (one search) |

- **Trial:** 5 NFL weeks per account, counted from first use, with week boundaries from ESPN's `scoringPeriodId`. Enforcement is described in [payments.md §5](payments.md#in-season-ai).
- **Season pass:** the same per-league, per-season pass as the draft plan. Existing passes include in-season.
- **The Sunday AI lineup** is generated by a timer at 11:40 ET, after the inactives for 1pm games. It's emailed, and it skips users who haven't opened the season page in two weeks.

### The AI outputs (11.2)

Both extend the draft plan's pipeline (`src/lib/ai/`): the same provider seam, structured output against a JSON schema, validation that never trusts the model, and a row in `ai_generations` for every call (`purpose` is `season-lineup`, `season-trade` or `season-trade-ideas`, so `npm run ai:costs` splits them). The model explains the engine's numbers and answers with refs; everything it says must come from the tables it was given.

- **AI lineup** (`src/lib/ai/season/lineup.ts`): the input is the optimal lineup, each slot's **close calls** (bench players within `CLOSE_POINTS`, 2 projected points, of the starter, never one ruled out or locked), injury designations, byes and lock state. The model writes a reason for every slot that's a close call or a move on ESPN, and may start any of a close call's options. Everywhere else the engine's pick stands. A ref that isn't in the input rejects the response; a start outside the options, or a player started twice, falls back to the engine's pick.
- **AI trade write-up** (`src/lib/ai/season/trade.ts`): the input is the trade verdict for both teams, recomputed on the server, plus both rosters with rest-of-season points, playoff-week points (from `playoffStartWeek`, parsed from ESPN's schedule) and remaining byes. The output is an accept/decline/counter lean, a summary, 2–4 reasons, and a counter-offer by ref when one is obvious. A counter with players on the wrong side is dropped.
- **Stored, never re-billed** (`season_ai_outputs`): lineups and trade ideas per league, week and kind; write-ups per league, week and trade. A lineup or set of trade ideas that fails gives the week's allowance back. Either way the free result still shows.
- **Routes:**
  - `POST /api/leagues/:id/season/lineup` writes this week's mid-week lineup.
  - `POST /api/leagues/:id/season/trade { partner, gives, gets }` writes a trade write-up.
  - `POST /api/leagues/:id/season/trade-ideas` finds this week's trade ideas. When no trade clears the bar it answers `{ ideas: null, none: true }`, which uses nothing and doesn't start the trial. After the deadline it answers 409 `{ deadline: true }`.
  - All three answer 402 past the trial without a pass, and 503 when the model fails.
- The AI lineup sees each player's NFL opponent, from the scoreboard (APE-211, prompt version 2). It's told to say nothing about that opponent beyond its name.

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

- **Pure checks** (`src/lib/season/apply.ts`), run in the browser while staging and again on the server: every move is the user's own player, where ESPN has them, unlocked, into a slot they're eligible for, and the result fits the league's starting slots, bench and IR spots. **IR (13.2):** the editor lists who's on IR and who could go there. Only players ESPN lists as `OUT` or `INJURY_RESERVE` may go on (`IR_STATUSES`; ESPN refuses anyone it doesn't mark injured), up to the league's IR spots (`lineupSlotCounts["21"]`). A player coming off IR needs room on the bench or a seat. IR moves ride in the same `ROSTER` transaction as the rest of the lineup.
- **Route:** `POST /api/leagues/:id/season/apply { week, snapshot, moves, consentVersion? }` (`src/lib/server/espn/applyLineup.ts`). Every write to ESPN, lineup or otherwise, goes through `guardedWrite.ts` (the guardrails below) and `transactionWriter.ts` (one `transactions/` POST). The team is the user's own, from their season link; the request never names one.

Guardrails:

1. The user reviews every move and confirms. Nothing is applied automatically: the Sunday job and the AI never write.
2. Re-read the roster (skipping the cache) right before writing. Abort if ESPN has moved on a week, if anything on the roster changed since staging (`snapshot`), or if the checks fail against the fresh roster (a player now locked). ESPN doesn't check `fromLineupSlotId`, and it has no dry run, so this check is ours to make.
3. Re-read after writing, even when the write timed out, and show which moves landed. ESPN refusing, a failed write, a move that didn't land, and a write that couldn't be checked all log `[server-error]`.
4. A separate, versioned consent line (`ESPN_WRITE_VERSION` in `src/lib/espn/disclosure.ts`, stored in `user_prefs.lineup_write_consent`), asked the first time the user confirms a change. Version 2 (Epic 13) covers the whole team: lineup, IR, adds and drops, waiver claims and trades. Users who agreed to version 1 are asked once more.

## 8. Open questions

- **Do future-week projections update week to week?** Compare a stored week-17 projection against a later read.
- **What shape does `mPendingTransactions` take** when a trade is pending? This is needed for importing offers.
