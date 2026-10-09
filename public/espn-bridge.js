// @ts-check
/**
 * War Room's ESPN draft bridge (Epic 8).
 *
 * A bookmarklet loads this into the user's own ESPN draft tab. It listens to the page's own draft
 * socket and relays the frames to War Room, which turns them into picks on the user's board.
 *
 * - It sends on ESPN's socket only to make a pick the user chose in War Room, and only while the
 *   page's own frames say the user's team is on the clock. Otherwise the page's sends pass through untouched.
 * - It forwards draft frames only, and strips what isn't draft data before anything leaves the tab:
 *   INIT (room state) and TOKEN (the user's ESPN id and join code) go as bare frame names, and every
 *   member GUID is zeroed. Draft data never carries ESPN cookies or passwords; the login cookies go
 *   only to connect the season, below, and never the password.
 * - It authenticates to War Room with a pairing token from a popup on War Room's own site, because
 *   cross-site requests from espn.com don't carry War Room's session cookie.
 * - Only if the user opts in from the overlay (9.1), it hands War Room this draft room's join code
 *   and the user's ESPN id, once, to their own endpoint, so War Room can join the draft itself and the
 *   user can draft from a phone with no ESPN tab open. Never in a frame, and never without that click.
 * - While War Room holds that connection, ESPN allows no second one for the team, so this tab stands
 *   down: it keeps ESPN's page from reconnecting (the page would take the connection straight back)
 *   until the user hands back, from War Room or with "Draft here instead" in the overlay.
 *
 * - Outside the draft, on an ESPN league or team page, it offers "Connect my season" (10.3). On a tap
 *   it hands Draft Room the user's ESPN login cookies, sealed under a one-time claim, and opens Draft
 *   Room in this tab, where the signed-in user agrees (once per account) and claims them. Inside the
 *   draft, once paired, it hands them over the paired token instead, since pairing asked the same
 *   consent (APE-332). Either way, only so Draft Room can read their leagues during the season.
 *
 * - It never leaves the user with nothing to see (APE-331): every click reads the page afresh and puts
 *   the overlay back on top, a failure to start still shows a message, and it tells Draft Room it
 *   loaded or failed (a beacon with the page kind and phone browser, nothing from ESPN but the league
 *   id). On Draft Room's own site it only says the bookmark works, for the setup steps.
 *
 * Plain script, no build step, so what's tested (src/lib/espn/bridge.test.ts) is exactly what ships.
 * The frame grammar is documented in docs/espn-protocol.md.
 */
/**
 * @typedef {{ playerId: string, espnPlayerId?: number, name: string, pos: string, team: string, bye: number, badge: string,
 *   tag?: { kind: "value" | "reach", label: string } }} OverlayPlayer
 */
(function () {
  "use strict";
  /** @type {any} */
  const w = window;
  if (w.__warRoomBridge) {
    // Clicked again: ESPN may have moved to another page in place since the first click, or taken
    // the overlay off the page. show() reads the page afresh and puts the overlay back on top.
    w.__warRoomBridge.show();
    return;
  }

  const script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  /**
   * War Room's origin: wherever this script was loaded from. The bookmark imports it as a module
   * (APE-339), which has no currentScript, so it leaves the origin on window; a bookmark from
   * before then loads it with a script tag.
   */
  const ORIGIN = script && script.src ? new URL(script.src).origin : w.__draftRoomOrigin || "https://draftroom.online";

  /**
   * Phone or computer, and which phone browser: only for the load beacon, so a failure can be told
   * apart by where it happens. Nothing else about the browser is sent.
   */
  const PLATFORM = (() => {
    const nav = w.navigator;
    const ua = String((nav && nav.userAgent) || "");
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav && nav.maxTouchPoints > 1)) return /CriOS/.test(ua) ? "ios-chrome" : "ios-safari";
    if (/Android/.test(ua)) return "android";
    return "desktop";
  })();
  const TOUCH = typeof w.matchMedia === "function" && w.matchMedia("(pointer: coarse)").matches;

  const BLOCKED = "Something on this page blocked Draft Room. Try again in Safari or Chrome without content blockers.";

  /**
   * fetch for requests to Draft Room. ESPN's phone site wraps the page's fetch, XHR and sendBeacon
   * in a "privacy-gateway" that refuses any domain it doesn't know (APE-339), so these go through
   * the untouched fetch of a hidden blank frame, which has the page's origin and so the same CORS.
   * The frame is put back if ESPN's page takes it off; the page's own fetch is the fallback.
   * @param {string} url @param {RequestInit} init
   * @returns {Promise<Response>}
   */
  function toDraftRoom(url, init) {
    return cleanFetch()(url, init);
  }

  /** @type {HTMLIFrameElement | null} */
  let netFrame = null;
  /** The frame's fetch, taken the moment it's added, before anything on the page can wrap it. @type {typeof fetch | null} */
  let netFetch = null;
  /** @returns {typeof fetch} */
  function cleanFetch() {
    try {
      // A frame without a fetch isn't tried again; one ESPN's page took off is put back.
      if (!netFrame || netFrame.isConnected === false) {
        netFrame = document.createElement("iframe");
        netFrame.setAttribute("aria-hidden", "true");
        netFrame.tabIndex = -1;
        netFrame.style.display = "none";
        (document.body || document.documentElement).appendChild(netFrame);
        const frameWindow = /** @type {any} */ (netFrame.contentWindow);
        netFetch = frameWindow && typeof frameWindow.fetch === "function" ? frameWindow.fetch.bind(frameWindow) : null;
      }
      if (netFetch) return netFetch;
    } catch {
      /* fall back to the page's own */
    }
    return fetch;
  }

  /**
   * Tells Draft Room the bridge loaded, failed, or how pairing went (APE-331), so a bookmark that
   * "does nothing" shows up somewhere. A plain-text no-cors post, so no preflight; never awaited,
   * never retried, and it carries no ESPN data beyond the league id.
   * @param {string} event @param {Record<string, string>} [extra]
   */
  function beacon(event, extra) {
    try {
      const body = JSON.stringify({ event, mode: pageMode(), platform: PLATFORM, espnLeagueId, ...extra });
      void toDraftRoom(`${ORIGIN}/api/espn/bridge/beacon`, { method: "POST", mode: "no-cors", credentials: "omit", keepalive: true, headers: { "content-type": "text/plain" }, body }).catch(() => {});
    } catch {
      /* telemetry never gets in the way */
    }
  }

  /**
   * The last line of defence: anything this script throws while starting up still leaves the user
   * a message rather than silence, and Draft Room a beacon. A plain box, no shadow DOM, since
   * whatever failed may have been the overlay itself. Removed once the bridge is up.
   * @param {{ error?: unknown, filename?: string }} e
   */
  function onStartupError(e) {
    if (w.__warRoomBridge || (e.filename && !String(e.filename).includes("/espn-bridge.js"))) return;
    if (typeof w.removeEventListener === "function") w.removeEventListener("error", onStartupError);
    beacon("error", { error: errorName(e.error) });
    try {
      const box = document.createElement("div");
      box.setAttribute("data-warroom-bridge", "");
      box.setAttribute("style", "position:fixed;top:12px;left:12px;right:12px;z-index:2147483647;font:15px/1.4 system-ui,sans-serif;color:#e8edf2;background:#10161d;border:1px solid #2b3a48;border-radius:12px;padding:14px 16px");
      box.textContent = BLOCKED;
      (document.body || document.documentElement).appendChild(box);
    } catch {
      /* nothing left to show it with */
    }
  }
  if (typeof w.addEventListener === "function") w.addEventListener("error", onStartupError);

  /** @param {unknown} err */
  function errorName(err) {
    const name = err && typeof err === "object" && "name" in err ? String(err.name) : "Error";
    return /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
  }
  const ESPN_SOCKET = /^wss:\/\/fantasydraft\.espn\.com\//;
  const ZERO_GUID = "{00000000-0000-0000-0000-000000000000}";
  const FLUSH_MS = 250;
  const HEARTBEAT_MS = 5000;
  const MAX_BATCH = 500;

  /*
   * What page this is. ESPN's site moves between pages in place, without loading a new page, so these
   * are read again whenever the address changes and on every click of the bookmark (APE-331), not
   * just once: a bridge first clicked on a league page must offer the draft once the user is there.
   */
  /** Draft Room's own site: the bookmark is being tried out, in the setup steps. */
  const onOwnSite = location.hostname === new URL(ORIGIN).hostname;
  let pageKey = "";
  let onDraftPage = false;
  let espnLeagueId = "";
  let espnTeamId = 0;
  let season = 0;
  /** An ESPN league or team page outside the draft: where "Connect my season" is offered (10.3). */
  let onSeasonPage = false;
  let TOKEN_KEY = "";
  let HANDOVER_KEY = "";
  /**
   * This page load's id. A reloaded ESPN tab starts a fresh frame log; the session id tells War Room
   * it's a new log continuing the same draft, not a gap in the old one.
   */
  let session = "";
  const newSession = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  /** Reads the page's address. True when it names a different league than before. */
  function readPage() {
    pageKey = location.pathname + location.search;
    const params = new URLSearchParams(location.search);
    const before = espnLeagueId;
    onDraftPage = location.hostname === "fantasy.espn.com" && location.pathname.startsWith("/football/draft");
    espnLeagueId = params.get("leagueId") || "";
    espnTeamId = Number(params.get("teamId")) || 0;
    // ESPN's league pages usually leave seasonId out. A season's playoffs run into January, so before
    // July the season that's on is last year's.
    const now = new Date();
    season = Number(params.get("seasonId")) || (now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear());
    onSeasonPage = !onDraftPage && location.hostname === "fantasy.espn.com" && location.pathname.startsWith("/football/") && /^\d+$/.test(espnLeagueId);
    TOKEN_KEY = `warroom-bridge:${espnLeagueId}`;
    HANDOVER_KEY = `warroom-handover:${espnLeagueId}`;
    return espnLeagueId !== before;
  }
  readPage();
  session = newSession();

  /** @returns {"own-site" | "draft" | "season" | "other"} */
  function pageMode() {
    return onOwnSite ? "own-site" : onDraftPage ? "draft" : onSeasonPage ? "season" : "other";
  }

  /** Sanitized frames since the bridge attached, in order. */
  const log = /** @type {string[]} */ ([]);
  /** How many of them War Room has confirmed. */
  let sent = 0;
  let inFlight = false;
  let lastPost = 0;
  let failures = 0;
  let sockets = 0;
  /** The newest attached ESPN socket still open: where a War Room pick is sent. */
  /** @type {WebSocket | null} */
  let current = null;
  /** The team on the clock, from the latest SELECTING (null right after a pick). */
  /** @type {number | null} */
  let onClockTeam = null;
  /** ESPN's outbound frames end in a newline; mirrored from the page's own sends to be safe. */
  let newline = true;
  /** Pick commands already handled, so a repeated delivery can never pick twice. */
  const handled = new Set();
  /**
   * The turn plan War Room published for this draft (8.14), and its version.
   * @type {{ picks: number[], rounds: string, onClock: boolean, targets: OverlayPlayer[], fallbacks: OverlayPlayer[], best: OverlayPlayer[], after: { picks: number[], names: string[] } | null } | null}
   */
  let plan = null;
  let planVersion = 0;
  /** ESPN ids drafted so far, from SELECTED frames: the plan hides them at once. */
  const takenEspn = new Set();
  /** Overlay drafting: the armed player's ESPN id, and a pick sent and not yet announced. */
  /** @type {number | null} */
  let armed = null;
  /** @type {string | null} */
  let draftingName = null;
  let expanded = false;
  /** What happened to the last command, reported on the next request. */
  /** @type {{ id: string, sent: boolean, reason?: string } | null} */
  let result = null;
  /** @type {"unpaired" | "listening" | "live" | "offline" | "expired" | "purchase" | "denied"} */
  let status = "unpaired";
  let token = readToken();
  /**
   * The join credential in the draft socket's URL: param 5 is `1:{league}:{team}:{SWID}:{code}`. Kept
   * here only so an opt-in can hand it over (9.1); it's never logged and never goes in a frame.
   * @type {string | null}
   */
  let joinParam = null;
  /** The hand-over opt-in War Room offers (its text is War Room's), and where the user is with it. */
  /** @type {{ version: number, lines: string[] } | null} */
  let handoverOffer = null;
  /** @type {"none" | "sending" | "done" | "failed" | "declined"} */
  let handover = readSession(HANDOVER_KEY) ? "done" : "none";
  /** War Room holds this team's ESPN connection: ESPN's page mustn't reconnect until it's handed back. */
  let heldByWarRoom = false;
  /** The user asked, from the overlay, to take the connection back; sent on the next check-in. */
  let releaseRequested = false;
  /** Stand-ins for the sockets ESPN's page tried to open while War Room held the connection. */
  const standIns = /** @type {Set<any>} */ (new Set());

  /* ---------------- frames ---------------- */

  /** @param {string} raw */
  function sanitize(raw) {
    const text = String(raw).trim();
    const head = text.split(" ", 1)[0];
    if (head === "PONG" || head === "") return null;
    if (head === "INIT" || head === "TOKEN") return head;
    return text.replace(/\{[0-9A-Fa-f-]{36}\}/g, ZERO_GUID);
  }

  /* ---------------- catch-up from INIT (8.12) ---------------- */

  /**
   * ESPN's INIT frame carries the whole draft: one 45-byte record per pick slot, the drafted
   * player's id as a big-endian int32 at the top of the record and -1 where nothing is drafted
   * yet. Each record also holds the league id, which is what lets us find the table without
   * assuming how long the header is.
   *
   * The blob itself never leaves this tab: we decode it here and send only the pick ids, the way
   * every other frame is stripped of anything identifying. Layout from docs/espn-protocol.md §4.1.
   *
   * The run of records is its own length: the draft has as many slots as the table has records, so
   * nothing has to be known about the league before decoding.
   *
   * @param {string} b64 the INIT payload
   * @param {number} league this draft's ESPN league id
   * Each record is also preceded by its 1-based pick number, which is how the table proves itself:
   * the record before it shares the league id but not the numbering.
   *
   * @returns {number[] | null} drafted player ids in pick order (empty before the first pick), or null if this isn't the layout we know
   */
  function decodeInitPicks(b64, league) {
    const STRIDE = 45;
    const LEAGUE_AT = 33;
    let bytes;
    try {
      // The frame is "INIT <base64> ####…": a base64 blob, then a long run of # padding, and the
      // base64 itself arrives without its own = padding. atob refuses both, so clean it up first.
      const clean = String(b64).split(/\s+/)[0].replace(/[^A-Za-z0-9+/]/g, "");
      const raw = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
      bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    } catch {
      return null;
    }
    const view = new DataView(bytes.buffer);
    const int = (/** @type {number} */ at) => view.getInt32(at);
    // Player ids are positive; D/ST are -16000 - proTeamId; -1 means the slot isn't drafted yet.
    const plausible = (/** @type {number} */ v) => v === -1 || (v >= 1000 && v <= 9_999_999) || (v <= -16_000 && v >= -16_100);

    /** Offsets where the league id appears, grouped into runs spaced exactly one record apart. */
    const runs = [];
    let run = [];
    for (let k = 0; k + 4 <= bytes.length; k++) {
      if (int(k) !== league) continue;
      if (run.length && k - run[run.length - 1] !== STRIDE) {
        runs.push(run);
        run = [];
      }
      run.push(k);
    }
    if (run.length) runs.push(run);
    runs.sort((a, b) => b.length - a.length);

    // A numbered table is taken as it stands, even empty: the record before it can pass for a pick
    // (its first field was 65536 before a draft), and falling through to it would invent one.
    for (const candidate of runs) {
      for (const first of [candidate[0] - LEAGUE_AT, candidate[0] - LEAGUE_AT + STRIDE]) {
        const total = candidate.length - (first - (candidate[0] - LEAGUE_AT)) / STRIDE;
        if (first < 4 || total < 1 || first + STRIDE * total > bytes.length) continue;
        let numbered = true;
        for (let k = 0; k < total && numbered; k++) numbered = int(first + STRIDE * k - 4) === k + 1;
        if (!numbered) continue;
        const ids = /** @type {number[]} */ ([]);
        for (let k = 0; k < total; k++) ids.push(int(first + STRIDE * k));
        if (!ids.every(plausible)) continue;
        const made = ids.filter((v) => v !== -1);
        if (made.some((v, i) => ids[i] !== v)) continue;
        return made;
      }
    }

    // No numbered table: fall back to the shape alone, which needs at least one pick to go on.
    for (const candidate of runs) {
      // A record before the table shares the tag, so try both alignments and let the shape decide.
      for (const [first, total] of [
        [candidate[0] - LEAGUE_AT, candidate.length],
        [candidate[0] - LEAGUE_AT + STRIDE, candidate.length - 1],
      ]) {
        if (first < 0 || total < 1 || first + STRIDE * total > bytes.length) continue;
        const ids = /** @type {number[]} */ ([]);
        for (let k = 0; k < total; k++) ids.push(int(first + STRIDE * k));
        if (!ids.every(plausible)) continue;
        const made = ids.filter((v) => v !== -1);
        // Drafted picks are a prefix of the table: every -1 comes after every id.
        if (made.some((v, i) => ids[i] !== v)) continue;
        if (made.length) return made;
      }
    }
    return null;
  }

  /**
   * This league as ESPN has it: team count, draft order, roster and the reception scoring item (8.8).
   * Trimmed here rather than posted whole, because the settings document is large and most of it is
   * scoring rules War Room doesn't read.
   */
  async function leagueSettings() {
    const url =
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
      `/segments/0/leagues/${encodeURIComponent(espnLeagueId)}?view=mSettings`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`mSettings -> HTTP ${res.status}`);
    const data = await res.json();
    const s = (data && data.settings) || {};
    const draft = s.draftSettings || {};
    const items = ((s.scoringSettings || {}).scoringItems || []).filter((/** @type {{statId: number}} */ i) => i && i.statId === 53);
    return {
      name: typeof s.name === "string" ? s.name.slice(0, 80) : undefined,
      size: s.size,
      // `date` is when the draft is scheduled (epoch ms): War Room's draft-day countdown follows it.
      draftSettings: { type: draft.type, pickOrder: draft.pickOrder, date: draft.date },
      rosterSettings: { lineupSlotCounts: (s.rosterSettings || {}).lineupSlotCounts },
      scoringSettings: { scoringItems: items },
    };
  }

  /** ESPN's settings, waiting to ride along with the next check-in. */
  /** @type {Record<string, unknown> | null} */
  let settingsToSend = null;
  /** Serialized settings already sent, so an unchanged league isn't posted twice. */
  let settingsSent = "";
  /** The last settings read, for the pairing popup: it can't read ESPN's API from our own origin. */
  /** @type {Record<string, unknown> | null} */
  let lastSettings = null;

  async function readLeagueSettings() {
    try {
      const next = await leagueSettings();
      // Read for the popup as well as for War Room, so a first-time user can build their league
      // Not a league settings document: nothing worth sending, and War Room keeps what it has.
      if (typeof next.size !== "number") return;
      lastSettings = next;
      // The draft order is redrawn when the lobby opens, so this is read again, not just once.
      if (JSON.stringify(next) === settingsSent) return;
      settingsToSend = next;
      lastPost = 0; // go now rather than waiting for the heartbeat
      flushSoon();
    } catch {
      // War Room keeps whatever league settings it already had.
    }
  }

  /** Who owns each pick, in order. Pre-draft ESPN already lists every slot's team, even mid-draft. */
  async function pickOwnership() {
    const url =
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
      `/segments/0/leagues/${encodeURIComponent(espnLeagueId)}?view=mDraftDetail`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`mDraftDetail -> HTTP ${res.status}`);
    const data = await res.json();
    /** @type {{ overallPickNumber: number, teamId: number }[]} */
    const picks = (data && data.draftDetail && data.draftDetail.picks) || [];
    return picks
      .slice()
      .sort((a, b) => a.overallPickNumber - b.overallPickNumber)
      .map((p) => p.teamId);
  }

  /** Frames that arrive while catch-up is in flight, so the picks it recovers stay in front of them. */
  /** @type {string[] | null} */
  let held = null;

  /**
   * Every socket's INIT is caught up on, not just the first: a page that reconnects after a gap (War
   * Room held the connection, or the network dropped) missed the picks made meanwhile. War Room only
   * applies a recovered pick it doesn't already have, in order, so repeating the ones it has is harmless.
   * @param {string} b64
   */
  async function catchUp(b64) {
    if (held) return; // one at a time; the next socket's INIT gets its turn
    const ids = decodeInitPicks(b64, Number(espnLeagueId));
    if (!ids || !ids.length) return; // not the layout we know, or nothing drafted yet: nothing to catch up on
    held = [];
    try {
      // Who owns each pick. ESPN lists every slot's team from before the draft, so this works mid-draft.
      const teams = await pickOwnership();
      // Without ownership a recovered pick could be attributed to the wrong team, and the user's own
      // roster would be wrong. Better to have no catch-up than a board that lies.
      if (teams.length >= ids.length) for (let i = 0; i < ids.length; i++) log.push(`WR_CATCHUP ${i + 1} ${teams[i]} ${ids[i]}`);
    } catch {
      // No catch-up: War Room says so rather than showing a board that's quietly missing picks.
    }
    const queued = held;
    held = null;
    if (queued && queued.length) log.push(...queued);
    flushSoon();
  }

  const attached = new WeakSet();
  const caughtUpOn = new WeakSet();
  /** @param {WebSocket} ws */
  function attach(ws) {
    if (attached.has(ws) || !ESPN_SOCKET.test(String(ws.url))) return;
    attached.add(ws);
    sockets++;
    current = ws;
    try {
      joinParam = new URL(String(ws.url)).searchParams.get("5") || joinParam;
    } catch {
      /* not a URL we can read: nothing to hand over */
    }
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return;
      // INIT is the draft so far: what this socket missed before it opened.
      if (String(e.data).startsWith("INIT ") && !caughtUpOn.has(ws)) {
        caughtUpOn.add(ws);
        void catchUp(String(e.data).slice(5).trim());
      }
      const frame = sanitize(e.data);
      if (!frame) return;
      if (held) held.push(frame);
      else log.push(frame);
      flushSoon();
      const [head, team, player] = frame.split(" ");
      if (head === "STATE" && team === "1" && token) void readLeagueSettings();
      if (head === "SELECTING") {
        onClockTeam = Number(team);
        render();
      } else if (head === "SELECTED") {
        onClockTeam = null;
        takenEspn.add(Number(player));
        if (Number(team) === espnTeamId) draftingName = null;
        armed = null;
        render();
      }
    });
    ws.addEventListener("close", () => {
      sockets = Math.max(0, sockets - 1);
      if (current === ws) current = null;
      render();
    });
    render();
  }

  const Native = w.WebSocket;
  const send = Native.prototype.send;
  /**
   * Why the page wouldn't let the bridge listen to its sockets, if it wouldn't (a content blocker or
   * another extension got there first). The overlay says so instead of waiting for a draft it can't hear.
   * @type {string | null}
   */
  let relayBroken = null;
  // Not on Draft Room's own site, where the bookmark is only being tried out.
  if (!onOwnSite) {
    try {
      // Sockets opened before the click are caught on their next send (ESPN pings every 15s)...
      Native.prototype.send = function (/** @type {any} */ data) {
        attach(this);
        if (typeof data === "string" && attached.has(this)) newline = data.endsWith("\n");
        return send.call(this, data);
      };
      // ...and sockets opened after it, e.g. when ESPN reconnects, from their first frame.
      w.WebSocket = class extends Native {
        /** @param {string | URL} url @param {string | string[]} [protocols] */
        constructor(url, protocols) {
          // War Room holds the connection: ESPN's page gets a socket that never connects, so it can't
          // take the connection back. It closes when War Room hands back, and the page reconnects for real.
          if (heldByWarRoom && ESPN_SOCKET.test(String(url))) return standIn(String(url));
          super(url, protocols);
          attach(/** @type {WebSocket} */ (/** @type {unknown} */ (this)));
        }
      };
    } catch (err) {
      relayBroken = errorName(err);
      beacon("error", { error: relayBroken });
    }
  }

  /** A socket for ESPN's page that stays connecting until War Room hands the connection back. @param {string} url */
  function standIn(url) {
    const target = new EventTarget();
    /** @type {any} */
    const sock = Object.assign(target, {
      url,
      readyState: 0,
      protocol: "",
      extensions: "",
      bufferedAmount: 0,
      binaryType: "blob",
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send() {},
      close() {
        if (sock.readyState === 3) return;
        sock.readyState = 3;
        standIns.delete(sock);
        const ev = Object.assign(new Event("close"), { code: 1006, reason: "", wasClean: false });
        target.dispatchEvent(ev);
        if (typeof sock.onclose === "function") sock.onclose(ev);
      },
    });
    standIns.add(sock);
    render();
    return sock;
  }

  /** War Room took, or gave back, this team's ESPN connection. @param {boolean} next */
  function setHeld(next) {
    if (next === heldByWarRoom) return;
    heldByWarRoom = next;
    if (next) {
      // Close the page's own socket now, before War Room joins, rather than let ESPN's page find out
      // by losing it and reconnecting; the reconnect gets a stand-in.
      if (current) Native.prototype.close.call(current);
    } else {
      releaseRequested = false;
      for (const sock of [...standIns]) sock.close();
    }
    render();
  }

  /* ---------------- relay ---------------- */

  /** @param {string} key */
  function readSession(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function readToken() {
    return readSession(TOKEN_KEY);
  }
  /** @param {string | null} value */
  function writeToken(value) {
    token = value;
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: the token lives for this page only */
    }
  }

  async function flush() {
    if (!token || inFlight) return;
    const now = Date.now();
    if (sent >= log.length && now - lastPost < HEARTBEAT_MS) return;
    inFlight = true;
    lastPost = now;
    const from = sent;
    const frames = log.slice(sent, sent + MAX_BATCH);
    // Held for the whole request: settings that arrive mid-flight belong to the next post, not this
    // one, or they'd be marked sent without ever being sent.
    const sendingSettings = settingsToSend;
    try {
      const res = await toDraftRoom(`${ORIGIN}/api/espn/bridge/frames`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          espnLeagueId,
          session,
          seq: sent,
          frames,
          planVersion,
          handoverVersion: handoverOffer ? handoverOffer.version : 0,
          ...(releaseRequested ? { release: true } : {}),
          ...(result ? { result } : {}),
          ...(sendingSettings ? { settings: sendingSettings } : {}),
        }),
      });
      if (res.status === 200 || res.status === 409) {
        // 409: War Room holds a different number of frames (e.g. it restarted); resend from there.
        const body = await res.json().catch(() => ({}));
        sent = typeof body.have === "number" ? Math.min(Math.max(0, body.have), log.length) : sent + frames.length;
        failures = 0;
        status = sockets ? "live" : "listening";
        if (sendingSettings) {
          settingsSent = JSON.stringify(sendingSettings);
          if (settingsToSend === sendingSettings) settingsToSend = null;
        }
        if (res.status === 409) lastPost = 0;
        result = null;
        if (body.command) pickFromWarRoom(body.command);
        if (body.plan && typeof body.plan.version === "number" && body.plan.plan) {
          planVersion = body.plan.version;
          plan = body.plan.plan;
        }
        setHeld(body.held === true);
        const offer = body.handover;
        if (offer && typeof offer.version === "number" && Array.isArray(offer.lines)) {
          handoverOffer = { version: offer.version, lines: offer.lines.map(String) };
        }
      } else if (res.status === 401) {
        writeToken(null);
        status = "expired";
      } else if (res.status === 402) {
        status = "purchase";
      } else if (res.status === 403) {
        writeToken(null);
        status = "denied";
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      failures++;
      status = "offline";
      // Back off while War Room is unreachable: retry at the heartbeat, not every flush.
      lastPost = now;
    } finally {
      inFlight = false;
      render();
    }
    // Frames that arrived while this post was in flight go straight after it (only on progress, so a
    // War Room that keeps asking for the same offset can't make this spin).
    if (sent > from && sent < log.length) flushSoon();
  }

  /**
   * Makes a pick the user chose in War Room, on ESPN's own socket, exactly as ESPN's Draft button
   * would. Only when the page's latest frames have the user's team on the clock; never twice.
   * @param {{ id?: unknown, select?: unknown }} command
   */
  function pickFromWarRoom(command) {
    const id = String(command.id);
    if (handled.has(id) || typeof command.select !== "number") return;
    handled.add(id);
    if (!espnTeamId || onClockTeam !== espnTeamId) result = { id, sent: false, reason: "not-on-the-clock" };
    else if (!current) result = { id, sent: false, reason: "no-socket" };
    else {
      select(command.select);
      result = { id, sent: true };
    }
    lastPost = 0; // report straight away
  }

  /** Sends a pick on ESPN's socket. Callers have checked the user is on the clock. @param {number} espnPlayerId */
  function select(espnPlayerId) {
    send.call(/** @type {WebSocket} */ (current), `SELECT ${espnPlayerId}${newline ? "\n" : ""}`);
    onClockTeam = null;
  }

  const myTurn = () => !!current && espnTeamId > 0 && onClockTeam === espnTeamId;

  /**
   * Drafting from the overlay's plan: the first click arms a player, the second (or Enter) sends
   * him, exactly as War Room's own two-step pick does.
   * @param {OverlayPlayer} player
   */
  function draftFromOverlay(player) {
    if (!player.espnPlayerId || takenEspn.has(player.espnPlayerId)) return;
    if (armed !== player.espnPlayerId) {
      armed = player.espnPlayerId;
      return render();
    }
    armed = null;
    if (!myTurn()) return render();
    select(player.espnPlayerId);
    draftingName = player.name;
    render();
  }

  /* ---------------- hand-over (9.1) ---------------- */

  /**
   * Hands War Room this draft room's join code, once, because the user clicked to. The code only
   * exists in the socket URL; War Room stores it encrypted and deletes it when the draft completes.
   */
  async function handOver() {
    if (!token || !handoverOffer || handover === "sending") return;
    const parts = (joinParam || "").split(":");
    const code = parts[parts.length - 1];
    const swid = parts[3];
    // Only this draft's own credential: this league, this team, and a code shaped like ESPN's.
    if (parts.length !== 5 || parts[1] !== espnLeagueId || Number(parts[2]) !== espnTeamId || !/^-?\d{1,12}$/.test(code)) {
      handover = "failed";
      return render();
    }
    handover = "sending";
    render();
    /** @type {number[] | null} */
    let pickTeams = null;
    try {
      pickTeams = await pickOwnership();
    } catch {
      // War Room can still draft for the user; it just can't recover picks it missed after a restart.
    }
    try {
      const res = await toDraftRoom(`${ORIGIN}/api/espn/bridge/handover`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ espnLeagueId, consentVersion: handoverOffer.version, code, swid, settings: lastSettings, pickTeams }),
      });
      if (res.status === 409) {
        // The opt-in text changed since it was shown: show the current one before anything is stored.
        handoverOffer = null;
        handover = "none";
      } else if (res.ok) {
        handover = "done";
        try {
          sessionStorage.setItem(HANDOVER_KEY, String(handoverOffer.version));
        } catch {
          /* private mode: the overlay may offer again after a reload, which is harmless */
        }
      } else handover = "failed";
    } catch {
      handover = "failed";
    }
    render();
  }

  function tick() {
    if (location.pathname + location.search !== pageKey) followPage();
    if (!token) return;
    if (failures && Date.now() - lastPost < Math.min(30_000, HEARTBEAT_MS * failures)) return;
    void flush();
  }

  /**
   * Flushes as soon as a frame arrives, not just on the interval. With the user drafting from War
   * Room, this tab sits in the background, where Chrome slows repeating timers (to once a minute
   * after five hidden minutes). A timeout started from a socket event isn't slowed that way.
   */
  let flushQueued = false;
  function flushSoon() {
    if (flushQueued) return;
    flushQueued = true;
    setTimeout(() => {
      flushQueued = false;
      tick();
    }, 0);
  }

  /**
   * The page's address changed under the bridge, or the user clicked the bookmark again: read the
   * page afresh. A different league is a different draft, so its frame log, plan and pairing start over.
   */
  function followPage() {
    if (readPage()) {
      log.length = 0;
      sent = 0;
      session = newSession();
      token = readToken();
      status = token ? "listening" : "unpaired";
      plan = null;
      planVersion = 0;
      settingsToSend = null;
      settingsSent = "";
      lastSettings = null;
      handoverOffer = null;
      handover = readSession(HANDOVER_KEY) ? "done" : "none";
      takenEspn.clear();
      armed = null;
      draftingName = null;
      pairStep = "idle";
    }
    if (!onSeasonPage) seasonStep = "idle";
    if (onDraftPage && token) {
      void readLeagueSettings();
      void rollInSeason();
    }
    render();
  }

  setInterval(tick, FLUSH_MS);
  // Only once paired: an unpaired bridge has no business calling ESPN's API on the user's behalf.
  if (onDraftPage && token) {
    void readLeagueSettings();
    void rollInSeason();
  }

  /* ---------------- connecting the season (10.3, APE-298, APE-332) ---------------- */

  /**
   * Connecting from a league page happens in this tab: the login goes to Draft Room under a one-time
   * claim, sealed, and this tab opens Draft Room to claim it. No popup, since on a phone the ESPN tab
   * behind one can't be counted on to answer. What the user agrees to is asked there, where Draft
   * Room knows who they are, so it's asked once per account rather than on every connect (APE-332);
   * a claim nobody agrees to is deleted, or dies in minutes.
   * @type {"idle" | "sending" | "signed-out" | "failed"}
   */
  let seasonStep = "idle";

  async function connectSeason() {
    if (seasonStep === "sending") return;
    const login = espnLogin();
    if (!login) {
      seasonStep = "signed-out";
      return render();
    }
    seasonStep = "sending";
    render();
    try {
      const res = await toDraftRoom(`${ORIGIN}/api/espn/season/handoff`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ espnLeagueId, season, ...login }),
      });
      const body = res.ok ? await res.json() : null;
      if (!body || typeof body.claim !== "string") throw new Error(`handoff ${res.status}`);
      // ESPN's page, not ours: a plain navigation to Draft Room is the only way across.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign(`${ORIGIN}/espn/season?claim=${encodeURIComponent(body.claim)}`);
    } catch {
      seasonStep = "failed";
      render();
    }
  }

  /**
   * Connecting the draft connects the season too (APE-332): the user agreed to both at once when
   * pairing, and the login is right here, so this hands it to Draft Room over the paired token, with
   * no trip away from the draft. Once per league per tab; Draft Room skips it quietly where in-season
   * help isn't available, and a failure is retried on the next load rather than shown, since the
   * draft itself is connected either way.
   */
  async function rollInSeason() {
    const key = `warroom-season:${espnLeagueId}`;
    const login = espnLogin();
    if (!token || !onDraftPage || !login || readSession(key)) return;
    try {
      sessionStorage.setItem(key, "sending");
    } catch {
      /* private mode: at worst it's sent again on the next load, which is harmless */
    }
    let done = false;
    try {
      const res = await toDraftRoom(`${ORIGIN}/api/espn/bridge/season`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(login),
      });
      done = res.ok;
    } catch {
      /* tried again next load */
    }
    try {
      if (done) sessionStorage.setItem(key, "done");
      else sessionStorage.removeItem(key);
    } catch {
      /* as above */
    }
  }

  /** The user's ESPN login cookies, or null if ESPN hasn't set them (signed out). */
  function espnLogin() {
    /** @type {Record<string, string>} */
    const jar = {};
    for (const pair of String(document.cookie || "").split(/;\s*/)) {
      const at = pair.indexOf("=");
      if (at > 0) jar[pair.slice(0, at)] = pair.slice(at + 1);
    }
    return jar.espn_s2 && jar.SWID ? { espnS2: jar.espn_s2, swid: jar.SWID } : null;
  }

  /* ---------------- pairing ---------------- */

  /**
   * Where pairing is: the Draft Room window is open and the user hasn't finished there yet, or the
   * browser blocked it. Either way the overlay says so in the middle of the screen (APE-331), since a
   * popup that opened behind the ESPN window, or not at all, otherwise looks like nothing happened.
   * @type {"idle" | "waiting" | "blocked"}
   */
  let pairStep = "idle";

  function pair() {
    const url = `${ORIGIN}/espn/pair?league=${encodeURIComponent(espnLeagueId)}&team=${espnTeamId}&season=${season}`;
    // Centered over the ESPN window on a computer. A phone opens it as a tab and ignores the size.
    const width = 520;
    const height = 720;
    const left = Math.max(0, Math.round((w.screenX || 0) + ((w.outerWidth || width) - width) / 2));
    const top = Math.max(0, Math.round((w.screenY || 0) + ((w.outerHeight || height) - height) / 2));
    const opened = w.open(url, "warroom-pair", `popup,width=${width},height=${height},left=${left},top=${top}`);
    pairStep = opened ? "waiting" : "blocked";
    collapsed = false;
    beacon("pair", { outcome: opened ? "opened" : "blocked" });
    render();
  }

  w.addEventListener("message", (/** @type {MessageEvent} */ e) => {
    if (e.origin !== ORIGIN || !e.data) return;
    // The pairing popup asking what ESPN says about this league (8.8): it's on War Room's origin,
    // so it can't read ESPN's API itself. Only ever settings, and only to War Room's origin.
    if (e.data.type === "warroom-bridge-settings?") {
      const reply = (/** @type {Record<string, unknown> | null} */ settings) =>
        e.source && /** @type {Window} */ (e.source).postMessage({ type: "warroom-bridge-settings", settings }, ORIGIN);
      if (lastSettings) reply(lastSettings);
      else void readLeagueSettings().then(() => reply(lastSettings));
      return;
    }
    if (e.data.type !== "warroom-bridge-paired" || typeof e.data.token !== "string") return;
    writeToken(e.data.token);
    if (pairStep !== "idle") beacon("pair", { outcome: "paired" });
    pairStep = "idle";
    // Connected: on a phone, get out of the way of ESPN's draft and leave a pill to tap.
    collapsed = TOUCH;
    status = sockets ? "live" : "listening";
    lastPost = 0;
    render();
    if (onDraftPage) {
      void readLeagueSettings();
      void rollInSeason();
    }
    void flush();
  });

  /* ---------------- overlay ---------------- */

  const host = document.createElement("div");
  host.setAttribute("data-warroom-bridge", "");
  const root = host.attachShadow({ mode: "open" });
  /*
   * The overlay is a step the user has to take, so until they've taken it it sits across the top of
   * the screen over a dimmed page (APE-331): ESPN's own bars, banners and ads crowd the corners, where
   * it used to sit, and covered it. Once the draft is connected it gets out of the way: a plain panel
   * on a computer, a pill on a phone, which opens the panel again when tapped.
   */
  root.innerHTML = `<style>
    .bg{position:fixed;inset:0;z-index:2147483646;background:rgba(4,7,10,.62)}
    .box{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;font:15px/1.4 system-ui,sans-serif;color:#e8edf2;
      background:#10161d;border:1px solid #2b3a48;border-radius:12px;padding:14px 16px;box-shadow:0 10px 40px rgba(0,0,0,.5);
      width:min(520px,calc(100vw - 24px));box-sizing:border-box;max-height:calc(100vh - 24px);overflow:auto}
    .box.center{top:50%;transform:translate(-50%,-50%)}
    .box.pill{width:auto;max-width:calc(100vw - 24px);padding:6px 14px;border-radius:999px;cursor:pointer;font-size:13px}
    .box.pill>:not(.t){display:none}.box.pill .t{margin:0}
    .t{font-weight:700;letter-spacing:.02em;margin-bottom:4px}.t i{font-style:normal;color:#5fd38d}.t span{font-weight:400;color:#aab7c4;margin-left:6px}
    .s{color:#c9d3dc}.row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
    button{font:inherit;border-radius:8px;border:1px solid #2b3a48;background:#1b2530;color:inherit;padding:8px 14px;cursor:pointer}
    button.go,button.ha,button.sc,button.pa{background:#2e7d4f;border-color:#2e7d4f;font-weight:700}[hidden]{display:none}
    .plan{margin-top:8px;border-top:1px solid #2b3a48;padding-top:8px;font-size:13px}
    .ph{display:flex;align-items:baseline;gap:8px}.ph b{flex:1}.ph span{color:#8f9aa8;font-size:12px}
    .ph button{padding:1px 8px;font-size:12px}
    .rows{max-height:45vh;overflow:auto;margin-top:4px}
    .h{color:#8f9aa8;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:8px 0 2px}
    .p{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;border-left:3px solid #f59e42;background:#161e27;margin-top:4px}
    .p.best{border-left-color:#3ddc91}.p.armed{outline:1px solid #3ddc91}
    .b{font-weight:700;color:#f59e42;min-width:38px;font-variant-numeric:tabular-nums}.p.best .b{color:#3ddc91}
    .n{flex:1;min-width:0}.n div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.n small{color:#8f9aa8}
    .g{font-size:11px;padding:1px 5px;border-radius:4px}.g.value{color:#5ee39a;border:1px solid #2e7d4f}.g.reach{color:#ff8a8a;border:1px solid #8a3434}
    .d{padding:2px 8px;font-size:12px}.d.on{background:#3ddc91;border-color:#3ddc91;color:#0d1a14;font-weight:700}
    .note,.hn{color:#8f9aa8;font-size:12px;margin-top:6px}
    .ho{margin-top:10px;border-top:1px solid #2b3a48;padding-top:10px}.ho b{display:block;margin-bottom:4px}
    .ho ul{margin:0;padding-left:18px;color:#aab7c4;font-size:13px}.ho li{margin-top:3px}
    @media (pointer:coarse){button{padding:10px 16px}.row button{flex:1 1 auto}}
  </style><div class="bg" hidden></div><div class="box"><div class="t">Draft Room <i>●</i><span class="pl"></span></div><div class="s"></div>
  <div class="plan" hidden><div class="ph"><b class="pt"></b><span class="pr"></span><button class="more" type="button">More</button></div>
  <div class="rows"></div><div class="note"></div></div>
  <div class="ho" hidden><b>Draft from your phone?</b><ul></ul><div class="hn"></div>
  <div class="row"><button class="ha" type="button">Let Draft Room draft for me</button><button class="hd" type="button">No thanks</button></div></div>
  <div class="row"><button class="go" type="button">Connect to Draft Room</button><button class="pa" type="button" hidden>Open it again</button><button class="sc" type="button" hidden>Connect my season</button><button class="rel" type="button" hidden>Draft here instead</button><button class="x" type="button">Hide</button></div></div>`;
  const statusEl = /** @type {HTMLElement} */ (root.querySelector(".s"));
  const dotEl = /** @type {HTMLElement} */ (root.querySelector(".t i"));
  const goEl = /** @type {HTMLButtonElement} */ (root.querySelector(".go"));
  const hideEl = /** @type {HTMLButtonElement} */ (root.querySelector(".x"));
  const releaseEl = /** @type {HTMLButtonElement} */ (root.querySelector(".rel"));
  releaseEl.onclick = () => {
    releaseRequested = true;
    lastPost = 0;
    render();
    flushSoon();
  };
  const planEl = /** @type {HTMLElement} */ (root.querySelector(".plan"));
  const planTitleEl = /** @type {HTMLElement} */ (root.querySelector(".pt"));
  const planRoundEl = /** @type {HTMLElement} */ (root.querySelector(".pr"));
  const moreEl = /** @type {HTMLButtonElement} */ (root.querySelector(".more"));
  const rowsEl = /** @type {HTMLElement} */ (root.querySelector(".rows"));
  const noteEl = /** @type {HTMLElement} */ (root.querySelector(".note"));
  const handoverEl = /** @type {HTMLElement} */ (root.querySelector(".ho"));
  const handoverListEl = /** @type {HTMLElement} */ (root.querySelector(".ho ul"));
  const handoverNoteEl = /** @type {HTMLElement} */ (root.querySelector(".hn"));
  const handoverYesEl = /** @type {HTMLButtonElement} */ (root.querySelector(".ha"));
  const handoverNoEl = /** @type {HTMLButtonElement} */ (root.querySelector(".hd"));
  handoverYesEl.onclick = () => void handOver();
  handoverNoEl.onclick = () => {
    handover = "declined";
    render();
  };
  goEl.onclick = pair;
  const seasonEl = /** @type {HTMLButtonElement} */ (root.querySelector(".sc"));
  seasonEl.onclick = () => void connectSeason();
  /** The user put the overlay away: it shrinks to a pill rather than vanishing, so it's one tap back. */
  let collapsed = false;
  hideEl.onclick = () => {
    if (pairStep !== "idle") pairStep = "idle";
    else collapsed = true;
    render();
  };
  const backdropEl = /** @type {HTMLElement} */ (root.querySelector(".bg"));
  const pillEl = /** @type {HTMLElement} */ (root.querySelector(".pl"));
  const againEl = /** @type {HTMLButtonElement} */ (root.querySelector(".pa"));
  againEl.onclick = pair;
  moreEl.onclick = () => {
    expanded = !expanded;
    render();
  };

  // Enter drafts the armed player and Escape disarms, unless the user is typing in ESPN's page.
  document.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
    if (armed === null) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
    const player = plan && [...plan.targets, ...plan.fallbacks, ...plan.best].find((p) => p.espnPlayerId === armed);
    if (e.key === "Enter" && player) {
      e.preventDefault();
      draftFromOverlay(player);
    } else if (e.key === "Escape") {
      armed = null;
      render();
    }
  });

  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** @param {OverlayPlayer} p @param {boolean} best */
  function playerRow(p, best) {
    const row = el("div", `p${best ? " best" : ""}${armed === p.espnPlayerId ? " armed" : ""}`);
    const name = el("div", "n");
    name.append(el("div", undefined, p.name), el("small", undefined, `${p.pos} · ${p.team} · Bye ${p.bye}`));
    row.append(el("span", "b", p.badge), name);
    if (p.tag) row.append(el("span", `g ${p.tag.kind}`, p.tag.label));
    if (myTurn() && p.espnPlayerId && !draftingName) {
      const isArmed = armed === p.espnPlayerId;
      const button = /** @type {HTMLButtonElement} */ (el("button", `d${isArmed ? " on" : ""}`, isArmed ? "Confirm" : "Draft"));
      button.type = "button";
      button.title = isArmed ? `Draft ${p.name} in ESPN` : `Arm ${p.name}; click Confirm to draft him`;
      button.onclick = () => draftFromOverlay(p);
      row.append(button);
    }
    return row;
  }

  function renderPlan() {
    const live = !!token && sockets > 0 && onDraftPage && !heldByWarRoom;
    planEl.hidden = !live;
    if (!live) return;
    if (!plan) {
      planTitleEl.textContent = "Your turn plan";
      planRoundEl.textContent = "";
      moreEl.hidden = true;
      rowsEl.replaceChildren();
      noteEl.textContent = "Open your Draft Room board to see your turn plan here.";
      return;
    }
    const open = (/** @type {OverlayPlayer[]} */ list) => list.filter((p) => !p.espnPlayerId || !takenEspn.has(p.espnPlayerId));
    const targets = open(plan.targets);
    const fallbacks = open(plan.fallbacks);
    const best = open(plan.best);
    const turn = `pick${plan.picks.length > 1 ? "s" : ""} ${plan.picks.join(" & ")}`;
    planTitleEl.textContent = myTurn() ? `You're on the clock: ${turn}` : `Your next turn: ${turn}`;
    planRoundEl.textContent = `round ${plan.rounds}`;
    moreEl.hidden = false;
    moreEl.textContent = expanded ? "Less" : "More";
    /** @type {HTMLElement[]} */
    const nodes = [];
    const section = (/** @type {string} */ title, /** @type {OverlayPlayer[]} */ list, /** @type {boolean} */ isBest) => {
      if (!list.length) return;
      nodes.push(el("div", "h", title), ...list.map((p) => playerRow(p, isBest)));
    };
    if (expanded) {
      section("Targets (in priority order)", targets, false);
      section("If they're gone", fallbacks, false);
      section("Best on the board, for your needs", best, true);
    } else {
      const top = [...targets, ...fallbacks].slice(0, 3);
      section("Targets", top.length ? top : best.slice(0, 3), !top.length);
    }
    rowsEl.replaceChildren(...nodes);
    const armedPlayer = armed !== null ? [...targets, ...fallbacks, ...best].find((p) => p.espnPlayerId === armed) : null;
    noteEl.textContent = draftingName
      ? `Drafting ${draftingName} in ESPN…`
      : armedPlayer
        ? `Click Confirm or press Enter to draft ${armedPlayer.name}. Esc cancels.`
        : expanded && plan.after
          ? `After that, pick${plan.after.picks.length > 1 ? "s" : ""} ${plan.after.picks.join(" & ")}: ${plan.after.names.join(", ") || "see your board"}`
          : myTurn()
            ? "Draft here or in ESPN."
            : "";
  }

  function renderHandover() {
    const live = !!token && sockets > 0 && onDraftPage && !!joinParam && !heldByWarRoom;
    handoverEl.hidden = !live || !handoverOffer || handover === "declined";
    if (handoverEl.hidden || !handoverOffer) return;
    handoverListEl.replaceChildren(...handoverOffer.lines.map((line) => el("li", undefined, line)));
    const done = handover === "done";
    handoverListEl.hidden = done;
    handoverYesEl.hidden = done;
    handoverNoEl.hidden = done;
    handoverYesEl.disabled = handover === "sending";
    handoverNoteEl.textContent = done
      ? "Handed over. Take over from Draft Room when you're ready to leave this tab."
      : handover === "sending"
        ? "Handing over…"
        : handover === "failed"
          ? "Couldn't hand over. Keep drafting here; try again in a moment."
          : "";
  }

  const picks = () => log.filter((f) => f.startsWith("SELECTED ")).length;

  function render() {
    if (armed !== null && !myTurn()) armed = null;
    const pairing = pairStep !== "idle" && onDraftPage && !token && !relayBroken;
    const needsPairing = !token && onDraftPage && !relayBroken && !pairing;
    goEl.hidden = !needsPairing;
    goEl.textContent = status === "expired" ? "Connect again" : "Connect to Draft Room";
    againEl.hidden = !pairing;
    againEl.textContent = pairStep === "blocked" ? "Open it" : "Open it again";
    hideEl.textContent = pairing ? "Cancel" : "Hide";
    let text;
    seasonEl.hidden = !onSeasonPage;
    seasonEl.textContent = seasonStep === "failed" || seasonStep === "signed-out" ? "Try again" : "Connect my season";
    seasonEl.disabled = seasonStep === "sending";
    if (onOwnSite) text = "✓ Your bookmark works. Next, open your league on ESPN and tap it there.";
    else if (relayBroken) text = BLOCKED;
    else if (pairing)
      text =
        pairStep === "blocked"
          ? "Your browser blocked the Draft Room window. Tap Open it to finish connecting."
          : TOUCH
            ? "Finish connecting in the Draft Room tab, then come back to this one."
            : "Finish connecting in the Draft Room window.";
    else if (onSeasonPage)
      text =
        seasonStep === "sending"
          ? "Opening Draft Room…"
          : seasonStep === "signed-out"
            ? "ESPN says you're signed out on this page. Sign in to ESPN, then try again."
            : seasonStep === "failed"
              ? "Couldn't reach Draft Room. Check your connection and try again."
              : "Get Draft Room's weekly lineup and trade help for this league.";
    else if (!onDraftPage) text = "Open your ESPN league or draft, then tap the Draft Room bookmark again.";
    else if (status === "expired") text = "Your Draft Room connection expired.";
    else if (status === "denied") text = "ESPN live sync isn't available on this Draft Room account yet.";
    else if (status === "purchase") text = "This league needs a Draft Room season pass for live sync.";
    else if (!token) text = "Connect this draft to your Draft Room board.";
    else if (status === "offline") text = "Can't reach Draft Room. Retrying…";
    else if (heldByWarRoom)
      text = releaseRequested ? "Handing the connection back to this tab…" : "Draft Room is drafting for you, so this tab stays disconnected. You can close it.";
    else if (!sockets) text = "Connected. Waiting for ESPN's draft…";
    else text = `Live · ${picks()} picks synced. Keep this tab open.`;
    statusEl.textContent = text;
    releaseEl.hidden = !heldByWarRoom || releaseRequested;
    dotEl.style.color = heldByWarRoom ? "#7cb7ff" : token && sockets && status !== "offline" ? "#5fd38d" : "#e0a100";
    renderPlan();
    renderHandover();
    // Connected to a draft is the only state that asks nothing of the user; everything else is a
    // step to take, in front of a dimmed page.
    const connected = onDraftPage && !!token && !relayBroken && status !== "purchase";
    const pill = collapsed && !pairing;
    pillEl.textContent = pill ? pillText(connected) : "";
    boxEl.className = `box${pill ? " pill" : pairing ? " center" : ""}`;
    backdropEl.hidden = pill || (connected && !pairing);
    fitToScreen();
  }

  /** @param {boolean} connected */
  function pillText(connected) {
    if (!connected) return "Tap to open";
    if (heldByWarRoom) return "Drafting for you";
    if (status === "offline") return "Reconnecting…";
    return sockets ? `Live · ${picks()} picks` : "Connected";
  }

  /**
   * ESPN serves phones its desktop page, zoomed out to fit (often to a third), and the overlay's
   * pixels shrink with it until it's unreadable (APE-304). On a touch screen, undo that zoom: scale
   * the box by how many page pixels span one screen pixel, and place it across the top (or in the
   * middle, while pairing) of what's on screen, which pinching and scrolling move. Elsewhere the
   * stylesheet's own placement stands.
   */
  const boxEl = /** @type {HTMLElement} */ (root.querySelector(".box"));
  boxEl.onclick = () => {
    if (!collapsed) return;
    collapsed = false;
    render();
  };
  function fitToScreen() {
    const vv = w.visualViewport;
    const screenWidth = w.screen && vv ? (vv.width > vv.height ? Math.max(w.screen.width, w.screen.height) : Math.min(w.screen.width, w.screen.height)) : 0;
    const k = vv && TOUCH && screenWidth > 0 ? vv.width / screenWidth : 1;
    if (!vv || k < 1.05) {
      Object.assign(boxEl.style, { top: "", left: "", width: "", maxHeight: "", transform: "", transformOrigin: "" });
      return;
    }
    const pill = boxEl.className.includes("pill");
    const width = Math.min(520, screenWidth - 24);
    Object.assign(boxEl.style, { top: "0px", left: "0px", width: pill ? "auto" : `${width}px`, maxHeight: `${Math.round(vv.height / k) - 24}px`, transformOrigin: "0 0" });
    const boxWidth = (pill && boxEl.offsetWidth) || width;
    const height = boxEl.offsetHeight || 0;
    const x = vv.offsetLeft + (vv.width - boxWidth * k) / 2;
    const y = boxEl.className.includes("center") ? vv.offsetTop + (vv.height - height * k) / 2 : vv.offsetTop + 12 * k;
    boxEl.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  }
  if (w.visualViewport) {
    w.visualViewport.addEventListener("resize", fitToScreen);
    w.visualViewport.addEventListener("scroll", fitToScreen);
  }

  /** On top of the page: appended last, so it's above anything ESPN added at the same z-index since. */
  const mount = () => (document.body || document.documentElement).appendChild(host);
  mount();
  render();
  if (token) void flush();
  beacon("load");
  /** On Draft Room's own site: tell the setup steps the bookmark worked, then step aside for them. */
  function triedOut() {
    if (!onOwnSite) return;
    if (typeof w.postMessage === "function") w.postMessage({ type: "warroom-bridge-ready" }, ORIGIN);
    setTimeout(() => host.remove(), 2500);
  }
  triedOut();

  w.__warRoomBridge = {
    show() {
      collapsed = false;
      mount();
      followPage();
      beacon("load", { again: "1" });
      triedOut();
    },
    /** For tests and support: what the bridge is doing. */
    state: () => ({ status, sent, frames: log.length, sockets, paired: !!token, onDraftPage, onSeasonPage, seasonStep, planVersion, armed, drafting: draftingName, handover, held: heldByWarRoom, standIns: standIns.size }),
    /** Exposed so the INIT decoder can be run against blobs recorded from real drafts (8.12). */
    decodeInitPicks,
  };
  if (typeof w.removeEventListener === "function") w.removeEventListener("error", onStartupError);
})();
