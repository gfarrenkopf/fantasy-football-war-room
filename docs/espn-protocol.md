# ESPN live draft protocol

What we know about ESPN's live draft, from two test drafts on 2026-09-21: the original HAR spike (league 810213965) and the 8.2 verification draft (league 704343562). None of it is documented or supported by ESPN, and it can change without notice.

## Contents

1. [Summary](#1-summary)
2. [REST API](#2-rest-api)
3. [The draft socket](#3-the-draft-socket)
4. [Message grammar](#4-message-grammar)
5. [Player ids](#5-player-ids)
6. [Probe scripts](#6-probe-scripts)
7. [Open questions](#7-open-questions)

---

## 1. Summary

| Question | Answer |
|---|---|
| Can a server read live picks over REST? | **No.** `mDraftDetail` shows `inProgress: true` with no picks filled for the whole draft, then all of them the moment it completes. |
| Can a server join the draft socket with the user's cookies? | **Not yet.** The join URL carries a security code that the server has no known way to get (§3). |
| Would a server socket be safe even with the code? | **No, not as a listener.** ESPN allows one connection per member. A second connection gets the first a "Duplicate Connection" dialog. That's acceptable only if the war room becomes the user's sole drafting client. |
| Can code in the user's own ESPN draft tab read the live socket? | **Yes.** Hooking `WebSocket.prototype.send` catches the page's socket on its next PING (every 15s), and a `message` listener then sees every frame. |
| Does ESPN's page restrict what injected code can load or call? | **No.** The draft page's CSP sets only `frame-ancestors`, with no `script-src` or `connect-src`. |

This is why Epic 8 relays picks through a browser bridge running in the user's ESPN tab instead of a server-side client.

## 2. REST API

Base: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}`. Private leagues need the `espn_s2` and `SWID` cookies.

| View | Useful fields |
|---|---|
| `mSettings` | `settings.size`; `draftSettings.{type, pickOrder, date, availableDate, timePerSelection, keeperCount}`; `rosterSettings.lineupSlotCounts`; the reception scoring item (`statId` 53, `points` 1 / 0.5 / 0) |
| `mTeams` | `teams[].{id, abbrev, name, owners[]}`. The user's team is the one whose `owners` contains their SWID. |
| `mDraftDetail` | `draftDetail.{drafted, inProgress, picks[]}` |

- **Before the draft, `picks` already lists every slot** with its `overallPickNumber`, `roundId`, `teamId`, `keeper` and `reservedForKeeper`, and `playerId: -1`. So pick ownership (including keepers) is known in advance.
- **`pickOrder` is randomized when the lobby opens.** With `orderType: "DRAFT_START"` it changed from `[1,2,3,4]` to `[1,4,3,2]` at `availableDate`, one hour before `date`. Read the draft slot after the lobby opens, not at import time.
- **ESPN's player list is public.** `GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/players?view=players_wl` with header `X-Fantasy-Filter: {"filterActive":{"value":true}}` returns about 2,650 players (`id`, `fullName`, `proTeamId`, `defaultPositionId`) with no cookies.

## 3. The draft socket

```
wss://fantasydraft.espn.com/game-1/league-{L}/JOIN
  ?1=1&2={L}&3={teamId}&4={SWID}&5=1:{L}:{teamId}:{SWID}:{code}&6=false&7=false&8=KONA&nocache={random}
Origin: https://fantasy.espn.com
```

- **`{code}` is a 9-digit security code.**
  - A random value upgrades to 101 and then gets `ERROR 1 Invalid+security+code%3B+access+is+refused.` followed by a close.
  - The code is the same across fresh page loads for the same member and league, so it's issued per member rather than per connection.
- **Where it doesn't come from:**
  - any of 19 league REST views, including `kona_*` and `mDraftDetail`
  - the draft page's HTML
  - reachable page state (`window`, `localStorage`, `sessionStorage`)
  - simple hashes of league, team and SWID
- **The server echoes the code back** in a `TOKEN` frame after joining.
- **Before the lobby opens,** every join returns HTTP 500.

## 4. Message grammar

Frames are space-delimited text ending in a newline. `INIT` is the exception: a base64 blob (about 7KB in a 4-team draft) that we don't decode.

| Frame | Direction | Meaning |
|---|---|---|
| `INIT <base64>` | in | full room state on join |
| `TOKEN 1:{L}:{team}:{SWID}:{code}` | in | join accepted |
| `JOINED <team> <memberGuid>` / `LEFT <team> <memberGuid> <n>` | in | presence |
| `CLOCK <team> <msRemaining>` | in | every 5s |
| `STATE 1` / `STATE 2` | in | draft started / complete |
| `SELECTING <team> <msAllowed>` | in | team on the clock |
| `AUTOSUGGEST <playerId>` | in | ESPN's suggestion for the team on the clock |
| `AUTODRAFT <team> true\|false` | in | a team's autopick toggled |
| `SELECTED <team> <playerId> <rosterSlot> [memberGuid]` | in | **the pick** |
| `SELECT <playerId>` | out | the user makes a pick |
| `AUTODRAFT true\|false` | out | the user toggles autopick |
| `PING PING%20<ms>` → `PONG PING%20<ms>` | out → in | heartbeat, every 15s |
| `ERROR <n> <urlencoded message>` | in | refusal, followed by a close |

- **A human pick carries the drafter's member GUID; an autopick never does.** An autopick after a timeout is preceded by `AUTODRAFT <team> true`.
- **Pick numbers aren't in the frame.** The overall pick number is the running count of `SELECTED` frames, reconciled against `draftDetail.picks`.
- In the spike, pick-to-broadcast latency averaged 255ms (167–356ms across 14 picks).

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

- **Where does the security code come from?** A full HAR of every request type, recorded from before the draft page loads, should show it. If a server can fetch it with cookies, a server-side client becomes possible, but only as the user's sole drafting client (§1).
- **How do we catch up on picks made before the bridge attached?** The picks are in `INIT` (binary) and presumably in the draft page's own store.
