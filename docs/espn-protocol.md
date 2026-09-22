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
- **ESPN's page doesn't fight back.** The duplicate connection puts a "Duplicate Connection — you signed into this draft from another location" dialog on the page, offering Exit Draft or Reconnect, and the page stays disconnected until a human chooses. No auto-reconnect, so a server client keeps the connection.
- **An out-of-turn pick is refused without closing the socket:** `ERROR 1 Invalid+selection+team+%28N%29%3B+team+M+is+currently+on+the+clock.`, and frames keep flowing afterwards. So "ESPN closes after an `ERROR`" holds for the join refusal, not for this one.

**Still unknown, and it decides the design:** how long a code stays valid. The draft room only opens about an hour before the draft, so capturing one days ahead isn't possible; what matters is that a capture at lobby time survives into and through the draft. 2026-09-22 confirms roughly an hour.

## 4. Message grammar

Frames are space-delimited text ending in a newline. `INIT` is the exception: a base64 blob of a fixed-size binary record (§4.1).

| Frame | Direction | Meaning |
|---|---|---|
| `INIT <base64>` | in | full room state on join, picks included (§4.1) |
| `TOKEN 1:{L}:{team}:{SWID}:{code}` | in | join accepted |
| `JOINED <team> <memberGuid>` / `LEFT <team> <memberGuid> <n>` | in | presence |
| `CLOCK <state> <msRemaining> [team]` | in | every 5s. State 0 is the pre-draft countdown, with no team; state 6 is a live pick, and the third field is the team on the clock. |
| `STATE 1` / `STATE 2` | in | draft started / complete |
| `SELECTING <team> <msAllowed>` | in | team on the clock |
| `AUTOSUGGEST <playerId>` | in | ESPN's suggestion for the team on the clock |
| `AUTODRAFT <team> true\|false` | in | a team's autopick toggled |
| `SELECTED <team> <playerId> <rosterSlot> [memberGuid]` | in | **the pick** |
| `SELECT <playerId>` | out | the user makes a pick |
| `AUTODRAFT true\|false` | out | the user toggles autopick |
| `PING PING%20<ms>` → `PONG PING%20<ms>` | out → in | heartbeat, every 15s |
| `ERROR <n> <urlencoded message>` | in | refusal, followed by a close |

- **Outbound frames end in a newline.** For example `"PING PING%20…\n"`, `"SELECT 4429160\n"` and `"AUTODRAFT false\n"`, as recorded from the page's own sends.
- **ESPN accepts a `SELECT` sent on the page's socket by other code**, on the user's turn. The bridge's picks come back as `SELECTED` with the user's member GUID, exactly like a click on ESPN's Draft button. A pick sent out of turn is refused with `ERROR 1 Invalid selection team …` and the socket stays open (§3).
- **A human pick carries the drafter's member GUID; an autopick never does.** An autopick after a timeout is preceded by `AUTODRAFT <team> true`.
- **Pick numbers aren't in the frame.** The overall pick number is the running count of `SELECTED` frames, reconciled against `draftDetail.picks`.
- In the spike, pick-to-broadcast latency averaged 255ms (167–356ms across 14 picks).

**After the draft,** the socket closes and the page falls back to HTTP long-polling at `GET fantasydraft.espn.com/game-1/league-{L}/PING?1=…&token=…`, about every 7s. That's a possible second transport if the socket ever becomes unusable.

### 4.1 Inside INIT

A fixed-size binary blob: 6,890 bytes in a 2026 16-round draft, the same size at the first pick as at the eighteenth. Only the bytes for new picks change, so it's a slot table, not a log.

- **Every pick slot holds a big-endian `int32`:** the drafted player's ESPN id, or `-1` for a slot not yet drafted — the same `-1` convention as `mDraftDetail`'s pre-draft picks.
- In the recorded draft the pick ids sat on a **180-byte stride** (offsets 2182, 2362, 2542, …), with a second run of the same ids later in the blob (rosters, most likely).
- Comparing two `INIT`s from one draft, the slots that changed are exactly the picks made in between.

**So a client that joins late can recover the picks it missed from `INIT` alone**, without REST (which stays empty until the draft ends) and without the page. That covers a server restart mid-draft, and 8.12's catch-up. The exact record layout still needs pinning down before anything parses it in production: field offsets, how team and round are encoded, and what the second run of ids is.

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
- **How is ESPN's pick queue sent (8.15)?** It wasn't exercised in the recorded draft: no queue frames or calls appeared.
- **How do we catch up on picks made before the bridge attached?** `INIT` holds them (§4.1). What's left is decoding its records properly rather than fishing ids out by stride.
