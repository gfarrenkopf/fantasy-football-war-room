# ESPN live draft protocol

What we know about ESPN's live draft, from test drafts on 2026-09-21: the original HAR spike (league 810213965), the 8.2 verification draft (league 704343562), and bridge test drafts including one recorded from inside the page (league 351531362); and from the 2026-09-22 draft (league 110222051), where a server-side client joined, watched and drafted (§3). None of it is documented or supported by ESPN, and it can change without notice.

## Contents

1. [Summary](#1-summary)
2. [REST API](#2-rest-api)
3. [The draft socket](#3-the-draft-socket)
4. [Message grammar](#4-message-grammar)
5. [Player ids](#5-player-ids)
6. [Probe scripts](#6-probe-scripts)
7. [Open questions](#7-open-questions)
8. [In-season reads and lineup writes](#8-in-season-reads-and-lineup-writes)

---

## 1. Summary

| Question | Answer |
|---|---|
| Can a server read live picks over REST? | **No.** `mDraftDetail` shows `inProgress: true` with no picks filled for the whole draft, then all of them the moment it completes. |
| Can a server join the draft socket on its own? | **Not on its own.** The join URL carries a security code no server-reachable endpoint has yielded (§3). Read out of the user's page, though, it needs nothing else — **not even cookies** (§3). |
| Would a server socket be safe even with the code? | **Only as the sole client.** ESPN allows one connection per member. A second connection disconnects the first, which then waits for a human to hit Reconnect. Fine when the war room is the user's only drafting client, and it can then both watch and pick (§3). |
| Can code in the user's own ESPN draft tab read the live socket? | **Yes.** Hooking `WebSocket.prototype.send` catches the page's socket on its next PING (every 15s), and a `message` listener then sees every frame. |
| Does ESPN's page restrict what injected code can load or call? | **No.** The draft page's CSP sets only `frame-ancestors`, with no `script-src` or `connect-src`. |

This is why Epic 8 relays picks through a browser bridge running in the user's ESPN tab instead of a server-side client. A server client is possible **once the bridge has handed it a code** (§3), which is the route to drafting from a phone with no ESPN tab open.

## 2. REST API

Base: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}`. Private leagues need the `espn_s2` and `SWID` cookies.

| View | Useful fields |
|---|---|
| `mSettings` | `settings.size`; `draftSettings.{type, pickOrder, date, availableDate, timePerSelection, keeperCount}`; `rosterSettings.lineupSlotCounts`; the reception scoring item (`statId` 53, `points` 1 / 0.5 / 0) |
| `mTeams` | `teams[].{id, abbrev, name, owners[]}`. The user's team is the one whose `owners` contains their SWID. |
| `mDraftDetail` | `draftDetail.{drafted, inProgress, completeDate, picks[]}`. Each pick has `overallPickNumber`, `roundId`, `roundPickNumber`, `teamId`, `playerId`, `keeper`, `autoDraftTypeId` and `lineupSlotId`. D/ST `playerId`s are negative (`-16000 - team`). |

- **Before the draft, `picks` already lists every slot** with its `overallPickNumber`, `roundId`, `teamId`, `keeper` and `reservedForKeeper`, and `playerId: -1`. So pick ownership (including keepers) is known in advance.
- **`pickOrder` is randomized when the lobby opens.** With `orderType: "DRAFT_START"` it changed from `[1,2,3,4]` to `[1,4,3,2]` at `availableDate`, one hour before `date`. Read the draft slot after the lobby opens, not at import time.
- **ESPN's player list is public.** `GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/players?view=players_wl` with header `X-Fantasy-Filter: {"filterActive":{"value":true}}` returns about 2,650 players (`id`, `fullName`, `proTeamId`, `defaultPositionId`) with no cookies.

## 3. The draft socket

```
wss://fantasydraft.espn.com/game-1/league-{L}/JOIN
  ?1=1&2={L}&3={teamId}&4={SWID}&5=1:{L}:{teamId}:{SWID}:{code}&6=false&7=false&8=KONA&nocache={random}
Origin: https://fantasy.espn.com
```

- **`{code}` is a signed 9-digit security code** — it can be negative, so don't parse it as unsigned.
  - A random value upgrades to 101 and then gets `ERROR 1 Invalid+security+code%3B+access+is+refused.` followed by a close.
  - The code is the same across fresh page loads for the same member and league, so it's issued per member rather than per connection.
- **Where it doesn't come from:**
  - any of 19 league REST views, including `kona_*` and `mDraftDetail`
  - the draft page's HTML
  - reachable page state (`window`, `localStorage`, `sessionStorage`)
  - simple hashes of league, team and SWID
- **The server echoes the code back** in a `TOKEN` frame after joining.
- **Before the lobby opens,** every join returns HTTP 500. A league whose lobby isn't open gets the same 500, so a 500 says nothing about the code itself.
- **The join needs a browser `User-Agent`.** Without one it's HTTP 403, before any frame.

### What a server can do with the code (2026-09-22 draft)

Everything below ran from node with **no cookies at all** — only league, team, SWID and a code read out of the page's own socket URL:

- **The join succeeds and the whole draft arrives:** `INIT`, `TOKEN`, `CLOCK` every 5s, `SELECTING`, `AUTOSUGGEST`, `SELECTED`, presence.
- **A server client can draft.** `SELECT <playerId>` came back as `SELECTED <team> <playerId> <slot> {member}` carrying the user's own GUID, exactly like ESPN's Draft button.
- **A random code is still refused** under the same conditions, so the code, not the cookie, is the entire gate.
- **The code outlives the page that made it.** It kept working after the draft room was exited and its tab closed, across several fresh connections into a draft already in progress.
- **ESPN's page doesn't fight back.** The duplicate connection puts a "Duplicate Connection — you signed into this draft from another location" dialog on the page, offering Exit Draft or Reconnect, and the page stays disconnected until a human chooses. No auto-reconnect, so a server client keeps the connection: with the draft exited, it held the socket for 7+ minutes and several picks. **But not always (2026-09-23):** in the first full test of Epic 9, an ESPN tab left open reconnected by itself and traded the connection with War Room's client for about 20 minutes. ESPN's activity feed showed the team leaving and rejoining again and again. So the bridge in an open tab now stands down while War Room holds the connection: it gives the page's reconnects a socket that never connects, until the user hands back.
- **The heartbeat must end in a newline, or ESPN drops the client after about a minute.** `PING PING%20<ms>` without the trailing `\n` cost three separate connections at +65s, +66s and +68s, whether or not a draft page was open; the same client sending `"PING PING%20<ms>\n"` stayed up. A silent disconnect at roughly a minute means the heartbeat, not the page.
- **An out-of-turn pick is refused without closing the socket:** `ERROR 1 Invalid+selection+team+%28N%29%3B+team+M+is+currently+on+the+clock.`, and frames keep flowing afterwards. So "ESPN closes after an `ERROR`" holds for the join refusal, not for this one.

- **The code lasts the draft, at least.** The same code, captured from the page when the lobby opened, still joined about two hours later and after `STATE 2`, across a dozen connections and a page reconnect in between (which minted no new code — the page's socket carried the same one). The draft room only opens about an hour before the draft, so capturing one days ahead was never on; lasting the draft is what the design needs.
- **After the draft the socket stays open**, sending `CLOCK 4` every 20s.

## 4. Message grammar

Frames are space-delimited text ending in a newline. `INIT` is the exception: a base64 blob of a fixed-size binary record (§4.1).

| Frame | Direction | Meaning |
|---|---|---|
| `INIT <base64>` | in | full room state on join, picks included (§4.1) |
| `TOKEN 1:{L}:{team}:{SWID}:{code}` | in | join accepted |
| `JOINED <team> <memberGuid>` / `LEFT <team> <memberGuid> <n>` | in | presence |
| `CLOCK <state> [<msRemaining>] [team]` | in | every 5s. State 0 is the pre-draft countdown, with no team; state 6 is a live pick, and the third field is the team on the clock. After the draft it's a bare `CLOCK 4` every 20s, with no time and no team. While the League Manager has the draft paused it's a bare `CLOCK` with no fields at all (2026-09-23). |
| `STATE 1` / `STATE 2` | in | draft started / complete |
| `SELECTING <team> <msAllowed>` | in | team on the clock |
| `AUTOSUGGEST <playerId>` | in | ESPN's suggestion for the team on the clock |
| `AUTODRAFT <team> true\|false` | in | a team's autopick toggled |
| `SELECTED <team> <playerId> <rosterSlot> [memberGuid]` | in | **the pick** |
| `SELECT <playerId>` | out | the user makes a pick |
| `DRAFT_LIST <playerId> [<playerId> …]` | out | the pick queue, whole and in order |
| `AUTODRAFT true\|false` | out | the user toggles autopick |
| `PING PING%20<ms>` → `PONG PING%20<ms>` | out → in | heartbeat, every 15s |
| `ERROR <n> <urlencoded message>` | in | refusal, followed by a close |

- **Outbound frames end in a newline.** For example `"PING PING%20…\n"`, `"SELECT 4429160\n"` and `"AUTODRAFT false\n"`, as recorded from the page's own sends.
- **ESPN accepts a `SELECT` sent on the page's socket by other code**, on the user's turn. The bridge's picks come back as `SELECTED` with the user's member GUID, exactly like a click on ESPN's Draft button. A pick sent out of turn is refused with `ERROR 1 Invalid selection team …` and the socket stays open (§3).
- **The pick queue is a socket frame, not a REST call (8.15).** Queueing a player sends `DRAFT_LIST` with the *entire* queue in order, so it's a set, not an append: `DRAFT_LIST 4241478`, then `DRAFT_LIST 4241478 4239996`, then `DRAFT_LIST 4241478 4239996 4685472`. Nothing comes back, and no REST call fires. So War Room can set the queue with one frame — worth doing, because ESPN autopicks from the queue before its own rankings, which makes it the fallback when a connection dies on the clock. It overwrites whatever the user queued in ESPN, so it needs their say-so.
- **A human pick carries the drafter's member GUID; an autopick never does.** An autopick after a timeout is preceded by `AUTODRAFT <team> true`.
- **Pick numbers aren't in the frame.** The overall pick number is the running count of `SELECTED` frames, reconciled against `draftDetail.picks`.
- In the spike, pick-to-broadcast latency averaged 255ms (167–356ms across 14 picks).

**After the draft,** the page falls back to HTTP long-polling at `GET fantasydraft.espn.com/game-1/league-{L}/PING?1=…&token=…`, about every 7s. That's a possible second transport if the socket ever becomes unusable.

### 4.1 Inside INIT

**The frame is `INIT <base64> ####…`:** a base64 blob whose own `=` padding is stripped, then a space and a run of about 2,048 `#`. Both have to be cleaned off before decoding — `atob` refuses either.

The blob is the room's state, not a log of it: 6,890 bytes eighteen picks into a 4-team, 16-round draft, 8,840 near its end. The **pick table** inside it is pre-sized and holds the whole draft:

| Offset in record | Meaning |
|---|---|
| -4 | the slot's 1-based overall pick number (the last 4 bytes of the record before) |
| 0 | the drafted player's ESPN id as a big-endian `int32`, or `-1` for a slot nobody has taken yet |
| 4 | ESPN's roster slot |
| 33 | this draft's league id |

- **Records are 45 bytes**, one per pick slot, in pick order, running `teams × rounds` long.
- **The league id in every record is what locates the table**, so nothing has to assume how long the header is. One record *before* the table carries the same id, so an alignment is accepted when each record is preceded by its pick number (1, 2, 3, …). The header record isn't, and its first field can pass for a player id: `16777216` on 2026-09-22 (too big to be one), but `65536` in a pre-draft room on 2026-09-23, which an older decoder took as pick 1. Only a blob without the numbering falls back to the shape alone (plausible ids, drafted ones a prefix, at least one pick).
- Comparing two `INIT`s from one draft, the records that changed are exactly the picks made in between.
- **Team and round aren't in the record.** Pick ownership comes from `mDraftDetail`, which lists every slot's team from before the draft (§2) and is readable from the draft page (ESPN's API allows that origin with credentials).

**So a client that joins late can recover the picks it missed from `INIT` alone**, without REST picks (empty until the draft ends) and without the page. That covers a server restart mid-draft, and 8.12's catch-up.

**But a bookmarklet rarely sees one.** `INIT` arrives only when a socket opens, and the bridge attaches to a socket the page opened before the script loaded. Reloading doesn't help: it takes the bridge with it. So this decoder mainly serves a client that opens its own socket (Epic 9) and the case where ESPN's page reconnects while the bridge is attached. Catching up after a late bookmarklet click needs another source for the picks already made.

## 5. Player ids

- **D/ST ids are negative:** `-16000 - proTeamId`. For example, `-16034` is Houston.
- **Other negative ids** (e.g. coaches) appear in the player list but weren't drafted.
- Kickers have ordinary positive ids.

## 6. Probe scripts

The probes behind these findings aren't committed. They run against real ESPN accounts, and research artifacts stay out of the repo. Keep them locally under the git-ignored `.research/`. They read `ESPN_S2`, `SWID` and `LEAGUE_ID` from `.env.local` and never print cookie values. What they did:

- **probe:** read `mSettings`, `mTeams` and `mDraftDetail` with cookies, and search every response for token-like fields.
- **poll:** watch `mDraftDetail` every second through a live draft. This is what showed the post-draft-only behavior.
- **join:** open the draft socket from Node with a given security code. It's read-only: it only ever sends `PING`.

## 7. Open questions

- **Where does the security code come from?** Still unanswered by any server-reachable endpoint. It matters less now: the bridge can read it from the page's own socket URL, and that's enough for a server client (§3).
- **How long does a code stay valid?** The one thing the server-side design rests on. The draft room only opens about an hour before the draft, so a capture days ahead isn't possible; 2026-09-22 showed a code lasting about an hour, through a page exit and into a live draft.
- **How do we catch up on picks made before the bridge attached?** `INIT` holds them (§4.1). What's left is decoding its records properly rather than fishing ids out by stride.

## 8. In-season reads and lineup writes

From probes on 2026-09-24 (NFL week 3) against leagues 110222051 and 704343562, for Epic 10. What War Room does with these facts is in [in-season.md](in-season.md).

### Credentials

- **A private league refuses anonymous reads:** `401` with `type: "AUTH_LEAGUE_NOT_VISIBLE"`. With `espn_s2` + `SWID` as cookies, every view below works from Node.
- **`espn_s2` is not `HttpOnly`.** On `fantasy.espn.com`, `document.cookie` includes both `espn_s2` (294 characters in this sample) and `SWID`, so code running in the user's ESPN tab (the bookmarklet) can read them.
- **The pair is the whole session (APE-296, 2026-10-06).**
  - **What's sent:** no other cookie, header or token is needed, and nothing ties the session to an IP.
  - **`SWID`:** the account's permanent id.
  - **`espn_s2`:** the session. It lasts until ESPN ends it.
- **Reads don't renew `espn_s2`.** On a read with a working pair, nothing re-sets it:
  - `lm-api-reads.fantasy.espn.com` returns no `Set-Cookie`.
  - `fantasy.espn.com/football/team` sets only `region` and `_dcf` (7-day expiry).

  So a stored login can't be refreshed by using it. It lives exactly as long as the cookie ESPN issued at sign-in.
- **`espn_s2` outlasts the season.** In desktop Chrome on 2026-10-06, its `Expires` was 2027-11-10. That is exactly 400 days out, which is Chrome's cap on cookie lifetimes, so ESPN asks for at least that long.
  - The browser's expiry is never what ends a stored login: War Room deletes it on Feb 1 (`loginExpiry()`).
  - What can end it early is ESPN ending that session itself, for instance a password change.
  - Signing out of ESPN elsewhere doesn't end it. On 2026-10-06, a sign-out on one device signed out a second device that shared its session, but War Room's stored login and another saved session still read the league afterwards. So ESPN ends only the session that was signed out, not every session on the account.
  - Warning users before the cookie expires isn't worth building.
- **Official access:** there isn't any; see [espn-official-access.md](espn-official-access.md).
- **ESPN's app takes over most league links on iPhone (APE-303).** `fantasy.espn.com/.well-known/apple-app-site-association` gives the ESPN Fantasy app these paths, among others:
  - `/*/team`
  - `/*/league`
  - `/*/league/settings`
  - `/*/league/draftrecap`
  - `/*/players/add`
  - `/*/fantasycast`

  A tap on any of them opens the app, where the bookmark can't run. These don't open the app:
  - `/football/league/standings?leagueId=…` (a league page the bookmark recognizes)
  - `www.espn.com/fantasy/football/` (for signing in)

  Links War Room sends phone users to ESPN use those (`src/lib/espn/pages.ts`).

### Reads

Same base as §2.

| View | Useful fields |
|---|---|
| `mStatus` | `scoringPeriodId` (the current NFL week); `status.{firstScoringPeriod, finalScoringPeriod, currentMatchupPeriod, latestScoringPeriod}` |
| `mSettings` | `scoringSettings.scoringItems[].{statId, points, pointsOverrides}`, where `pointsOverrides` is keyed by lineup slot id (e.g. D/ST points-allowed tiers under `"16"`); `rosterSettings.{lineupSlotCounts, lineupLocktimeType}` (`INDIVIDUAL_GAME`); `scheduleSettings.{matchupPeriodCount, matchupPeriods, playoffTeamCount, playoffMatchupPeriodLengthByRound}` (a two-week final shows as `"16": [16, 17]`); `tradeSettings.deadlineDate` |
| `mRoster` + `mTeam` | `teams[].roster.entries[]`: `playerId`, `lineupSlotId`, `injuryStatus`, `acquisitionType`, `pendingTransactionIds`, and `playerPoolEntry.{lineupLocked, rosterLocked, tradeLocked, player.eligibleSlots, player.stats}` |
| `mPendingTransactions` | `pendingTransactions[]`: the reader's own pending waiver claims and the trades that involve them. Shapes are under "Roster transactions" below. |

Lineup slot ids are the ones in `espn/league.ts`: 0 QB, 2 RB, 4 WR, 6 TE, 16 D/ST, 17 K, 20 bench, 21 IR, 23 FLEX, 7 OP (superflex).

### Projections

`player.stats[]` entries are identified by `statSourceId` (0 actual, 1 projected) and `statSplitTypeId` (0 season, 1 one week, 2 unknown, see below). Their ids follow the pattern `{source}{split}{season}` for season rows and `{source}{split}{season}{week}` for weekly projections. Weekly actuals are keyed by game id instead.

- **Every future week is projected.** The public view `.../seasons/{season}/segments/0/leaguedefaults/3?view=kona_player_info`, with `filterStatsForTopScoringPeriodIds.additionalValue` listing ids such as `"11202617"`, returns a projection for each requested week through week 17 with no cookies. A bye week is projected as `0.0`.
- **The league-scoped `kona_player_info` returns only the requested `scoringPeriodId`'s weekly projection**, one week per request.
- **`appliedTotal` is scored for whoever asks.** Under `leaguedefaults/3` it's ESPN's default PPR. Under a league it's that league's scoring, and it matches Σ `stats[statId]` × `points` exactly for every row checked. So public raw `stats` + the league's `scoringItems` reproduces league scoring.
- **Split 2 (`12{season}`) is unexplained.** It's close to, but not equal to, the season projection (Gibbs: 386.3 against 380.6), and it doesn't match actuals plus the remaining weekly projections. Don't use it.
- **Public queries also return last season's weekly actuals**, keyed by game ids with the prior season's prefix. Filter on `seasonId`.

### Points scored and game state (APE-196)

- **Weekly actuals are in `mRoster`.** `player.stats[]` rows with `statSourceId 0`, `statSplitTypeId 1` are one NFL game each, keyed by game id (`externalId`, e.g. `401872932`), with `scoringPeriodId` and an `appliedTotal` scored in the league's own scoring. A row appears once the player's game has stats, and its `appliedTotal` rises during the game in the default read, without a `scoringPeriodId` (seen on the season page in week 4, 2026-10-04: Jalen Hurts at 0.6 with 8:38 left in the 1st).
- **An actual row has the stats behind its points (APE-247).** Next to `appliedTotal`, `stats` holds the game's raw stats by stat id, and `appliedStats` holds the league-scored points of each stat that scored. `appliedStats` already includes D/ST tiers, per-slot `pointsOverrides` and bonuses, and its values sum to `appliedTotal`. Seen 2026-10-06 on week-4 finals across 64 rostered players. A player who didn't play has a row with empty `stats` and a 0 total. The ids confirmed:
  - **Passing:** 3 yards, 4 TD, 19 two-point, 20 INT. Every-5/10/20/25/50/100-yard counts are 5–10.
  - **Rushing:** 24 yards, 25 TD, 26 two-point. Every-N-yard counts are 27–32.
  - **Receiving:** 42 yards, 43 TD, 44 two-point, 53 receptions, 58 targets. Every-N-yard counts are 47–52, and 56 is a 100–199-yard game.
  - **Fumbles lost:** 72.
  - **Kicking:** 83/84/85 are FG made/tried/missed and 86/87/88 XP made/tried/missed. Made by distance are 74, 77, 80 and 198.
  - **D/ST:** 120 points allowed, scored by tiers 89–92 and 121–125. 127 yards allowed, scored by tiers 128–136. 95 INT, 96 FR, 97 blocked kick, 98 safety, 99 sack.
- **Game state is public.** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={season}&seasontype=2&week={week}` needs no cookies (about 290 KB for a week). Each event has `status.type.state` (`pre`, `in` or `post`) and `status.type.shortDetail` ("Final", "Halftime", "4:12 - 3rd", or a kickoff time). `status.period` is the quarter (0 before kickoff, 5 and up in overtime) and `status.clock` the seconds left in it. Each competitor's `score` is a string ("21"), "0" before kickoff. Event ids are the same game ids as the stat rows and `proTeamSchedules_wl`. `competitions[0].competitors[].team.id` is the same pro-team id as `proTeamId` (GB 9, ATL 1, BUF 2, DET 8).
- **`proTeamSchedules_wl` has a `statsOfficial` flag per game.** It was still `false` the day after the game, so it isn't a signal that the game is final.

### Matchups (APE-211)

- **`mMatchupScore` carries the week's matchup totals** without a `scoringPeriodId` (2026-09-29, about 180 KB more on the season read). `schedule[]` entries for `status.currentMatchupPeriod` have `home` / `away` with `teamId`, `totalPoints` / `totalPointsLive`, `totalProjectedPoints` / `totalProjectedPointsLive` (ESPN's projection for the lineup set on ESPN) and `winProbability` (0–1). A bye has no `away`.
- **The public scoreboard names both teams.** Each competitor has `homeAway`, and the event has `date` (kickoff, ISO).

### Free agents (APE-212)

- **The league-scoped `kona_player_info` lists available players** with an `X-Fantasy-Filter` such as `{"players":{"filterStatus":{"value":["FREEAGENT","WAIVERS"]},"filterSlotIds":{"value":[0,2,4,6,16,17]},"limit":100,"sortPercOwned":{"sortAsc":false,"sortPriority":1}}}` and cookies (2026-09-29: 50 players ≈ 565 KB with stats). Each entry has `id`, `status` (`FREEAGENT` or `WAIVERS`), `waiverProcessDate` (epoch ms) and `player` (`fullName`, `defaultPositionId`, `proTeamId`, `injuryStatus`, `ownership`).
- **Waiver settings** are in `mSettings` `acquisitionSettings` (`acquisitionType`, `isUsingAcquisitionBudget`, `acquisitionBudget`, `waiverProcessDays`, `waiverProcessHour`). Each team's `waiverRank` and `transactionCounter.acquisitionBudgetSpent` are in `mTeam`.

### Lineup writes

`POST https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}/transactions/`, with cookies:

```json
{
  "isLeagueManager": false, "teamId": 2, "type": "ROSTER", "memberId": "{SWID}",
  "scoringPeriodId": 3, "executionType": "EXECUTE",
  "items": [
    { "playerId": 16800, "type": "LINEUP", "fromLineupSlotId": 20, "toLineupSlotId": 4 },
    { "playerId": 4426515, "type": "LINEUP", "fromLineupSlotId": 4, "toLineupSlotId": 20 }
  ]
}
```

- **One request carries many moves, applied atomically.** ESPN's own page sends a swap as two items. A request with a valid swap plus one illegal move was refused whole, and the swap didn't land.
- **Errors are `409`** with `details[].{type, message}`. Seen so far: `TRAN_ROSTER_INELIGIBLE_SLOT` ("… is not eligible for the QB slot."), `TRAN_ROSTER_SLOT_LIMIT_EXCEEDED` ("Too many players in the RB slot (maximum 2)"), `TRAN_ROSTER_SAME_SLOT` ("… is already in the BE slot"), `TRAN_LINEUP_LOCKED` ("Lineup transaction could not be completed, Drake London is locked").
- **`fromLineupSlotId` isn't checked against the roster.** A move with the wrong `fromLineupSlotId` failed only because its target was the player's current slot. Callers must re-read the roster before writing.
- **There is no dry run.** `executionType: "VALIDATE"` returns `400 Invalid Input.`
- **A locked player can't move (2026-09-24, during Thursday night's game).** A swap of a locked starter with a bench player was refused whole with `TRAN_LINEUP_LOCKED`, and neither player moved. The roster read's `playerPoolEntry.lineupLocked` was `true` for exactly the players in that game, so checking it before writing catches this first.
- **Six items in one transaction land together** (12.1 acceptance, three swaps on the test league), and a re-read straight after the write shows them.

### Roster transactions (Epic 13, 13.0)

From probes on 2026-09-29 (NFL week 4) against test league 704343562: team 1 from Node with the operator's cookies, and team 2 through ESPN's own pages. Every roster change goes to the same `transactions/` endpoint as lineup writes, with the same envelope (`isLeagueManager`, `teamId`, `memberId`, `scoringPeriodId`, `executionType`). Only `type` and `items` change. A 200 answers with the stored transaction: its `id`, `status` (`PENDING`, `EXECUTED`, `CANCELED`), `isPending`, and each item filled out with `fromLineupSlotId` / `toLineupSlotId` (`-1` off the roster) and `fromTeamId` / `toTeamId` (`0` for the pool).

**League rules** come from `mSettings`:

- **Roster size** is the sum of `rosterSettings.lineupSlotCounts` without IR (`"21"`). ESPN enforces it ("Too many players on roster (maximum 16)."). `lineupSlotCounts["21"]` is the IR slot count.
- **Limits:** `rosterSettings.positionLimits` holds per-position caps, where `-1` means none. `acquisitionSettings.acquisitionLimit` and `matchupAcquisitionLimit` hold acquisition caps (`-1` for none).
- `rosterSettings.isUsingUndroppableList`: ESPN's page greys out Drop for some players.
- `acquisitionSettings.acquisitionType` is `WAIVERS_TRADITIONAL` in the test league. `isUsingAcquisitionBudget` says whether the league bids FAAB, with `minimumBid`.
- `tradeSettings.{deadlineDate, revisionHours, vetoVotesRequired}`.
- Each team's `transactionCounter` counts `acquisitions`, `drops`, `trades`, `moveToIR` and `moveToActive`.

**IR** is a `ROSTER` / `LINEUP` move to slot 21, like any lineup move.

- Every player's `eligibleSlots` includes 21, so eligibility comes from injury status, not from slots.
- A `QUESTIONABLE` player is refused with `TRAN_ROSTER_INELIGIBLE_IR_NOT_INJURED` ("… is not eligible for the IL/IR slot, player is not injured.").
- Players ESPN marks `injured: true` carry `injuryStatus` `OUT` or `INJURY_RESERVE`.
- Confirmed live on the test league after waivers processed (Epic 13 acceptance): a landed IR move, and activation with a full bench.

**Free-agent add / drop:** `type: "FREEAGENT"`, with items `{ playerId, type: "ADD", toTeamId }` and `{ playerId, type: "DROP", fromTeamId }`.

- A player still on waivers is refused with `TRAN_PLAYER_NOT_FREEAGENT` ("… is not a free agent").
- In `WAIVERS_TRADITIONAL`, the whole pool sits on waivers until the league's process time after a week's games. On 2026-09-29 every available player showed `status: "WAIVERS"` with `waiverProcessDate` 2026-09-30 07:00 UTC. So an instant add is only possible between that time and the next week's lock.
- Confirmed live on the test league (Epic 13 acceptance): a landed add, and dropping a player whose game had started.

**Waiver claim:** `type: "WAIVER"`, with the same `ADD` / `DROP` items and `bidAmount` (`null` without FAAB).

- The drop is conditional: it only happens if the claim succeeds.
- A claim that would overfill the roster is refused up front with `TRAN_ROSTER_LIMIT_EXCEEDED_ONE`. Its `resolution` says "You must drop at least 1 player…".
- A placed claim is `status: "PENDING"` with a `processDate`, and ESPN's page shows it with the team's waiver priority. The dropped player's roster entry lists the claim's id in `pendingTransactionIds`.
- **Cancel** by sending the same `type` with `executionType: "CANCEL"`, `relatedTransactionId: <claim id>` and `items: []`. The answer is `status: "CANCELED"`, and the claim leaves `mPendingTransactions`.
- *Still to probe:* reordering claims (`subOrder`). A FAAB bid is shelved with FAAB support (APE-221); the test league doesn't bid.

**Trades:**

- **Propose:** `type: "TRADE_PROPOSAL"`, one `{ playerId, type: "TRADE", fromTeamId, toTeamId }` item per player. The proposer may add `DROP` items for their own team.
  - The answer carries `expirationDate`, 48 hours after proposing in the test league, and `teamActions: { "<proposer>": "ACCEPTED" }`.
  - Only the proposer's roster size is checked when proposing. A 1-for-2 without a drop is refused with `TRAN_ROSTER_LIMIT_EXCEEDED_ONE`, but a 2-for-1 that overfills the partner is accepted as a proposal.
- **Withdraw:** `type: "TRADE_PROPOSAL"`, `executionType: "CANCEL"`, `relatedTransactionId`, `items: []`. The answer is `status: "CANCELED"`.
- **Accept** (recorded from ESPN's page, team 2 accepting team 1's offer): `type: "TRADE_ACCEPT"`, `relatedTransactionId: <proposal id>`, and no `items` at all.
  - ESPN's page asks for the account password again ("Enter your password to continue") before it sends the accept. The API doesn't: team 1 accepted a proposal from Node with its stored cookies, days old, and got a 200.
  - After an accept, the proposal keeps its id but becomes `type: "TRADE_ACCEPT"`, `status: "PENDING"`, with `teamActions` showing both teams `ACCEPTED`, an `acceptedDate`, and a `processDate` `revisionHours` (24) later: the league's review period. Every player in it shows `tradeLocked: true` and lists the trade in `pendingTransactionIds`.
- **Decline:** `type: "TRADE_DECLINE"`, `relatedTransactionId`, no `items`. The answer is `status: "EXECUTED"`, and the proposal leaves `mPendingTransactions`.
- *Still to probe:*
  - how the partner drops to make room when accepting an uneven trade;
  - vetoes during review (`vetoVotesRequired` is 1 in the test league).

