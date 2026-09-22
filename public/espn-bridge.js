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
 *   member GUID is zeroed. War Room never sees ESPN cookies or passwords.
 * - It authenticates to War Room with a pairing token from a popup on War Room's own site, because
 *   cross-site requests from espn.com don't carry War Room's session cookie.
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
    w.__warRoomBridge.show();
    return;
  }

  const script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  /** War Room's origin: wherever this script was loaded from. */
  const ORIGIN = script && script.src ? new URL(script.src).origin : "https://draftroom.online";
  const ESPN_SOCKET = /^wss:\/\/fantasydraft\.espn\.com\//;
  const ZERO_GUID = "{00000000-0000-0000-0000-000000000000}";
  const FLUSH_MS = 250;
  const HEARTBEAT_MS = 5000;
  const MAX_BATCH = 500;

  const params = new URLSearchParams(location.search);
  const onDraftPage = location.hostname === "fantasy.espn.com" && location.pathname.startsWith("/football/draft");
  const espnLeagueId = params.get("leagueId") || "";
  const espnTeamId = Number(params.get("teamId")) || 0;
  const season = Number(params.get("seasonId")) || new Date().getFullYear();
  const TOKEN_KEY = `warroom-bridge:${espnLeagueId}`;
  /**
   * This page load's id. A reloaded ESPN tab starts a fresh frame log; the session id tells War Room
   * it's a new log continuing the same draft, not a gap in the old one.
   */
  const session = Math.random().toString(36).slice(2) + Date.now().toString(36);

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
   * @returns {number[] | null} drafted player ids in pick order, or null if this isn't the layout we know
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
      size: s.size,
      draftSettings: { type: draft.type, pickOrder: draft.pickOrder },
      rosterSettings: { lineupSlotCounts: (s.rosterSettings || {}).lineupSlotCounts },
      scoringSettings: { scoringItems: items },
    };
  }

  /** ESPN's settings, waiting to ride along with the next check-in. */
  /** @type {Record<string, unknown> | null} */
  let settingsToSend = null;
  /** Serialized settings already sent, so an unchanged league isn't posted twice. */
  let settingsSent = "";

  async function readLeagueSettings() {
    try {
      const next = await leagueSettings();
      // Not a league settings document: nothing worth sending, and War Room keeps what it has.
      if (typeof next.size !== "number") return;
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

  let caughtUp = false;
  /** Frames that arrive while catch-up is in flight, so the picks it recovers stay in front of them. */
  /** @type {string[] | null} */
  let held = null;

  /** @param {string} b64 */
  async function catchUp(b64) {
    if (caughtUp) return;
    caughtUp = true;
    const ids = decodeInitPicks(b64, Number(espnLeagueId));
    if (!ids) return; // not the layout we know, or nothing drafted yet: nothing to catch up on
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
  /** @param {WebSocket} ws */
  function attach(ws) {
    if (attached.has(ws) || !ESPN_SOCKET.test(String(ws.url))) return;
    attached.add(ws);
    sockets++;
    current = ws;
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return;
      // INIT is the draft so far. Only useful before we've seen picks of our own, i.e. we joined late.
      if (String(e.data).startsWith("INIT ") && !caughtUp && !log.some((f) => f.startsWith("SELECTED "))) {
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

  // Sockets opened before the click are caught on their next send (ESPN pings every 15s)...
  const proto = w.WebSocket.prototype;
  const send = proto.send;
  proto.send = function (/** @type {any} */ data) {
    attach(this);
    if (typeof data === "string" && attached.has(this)) newline = data.endsWith("\n");
    return send.call(this, data);
  };
  // ...and sockets opened after it, e.g. when ESPN reconnects, from their first frame.
  const Native = w.WebSocket;
  w.WebSocket = class extends Native {
    /** @param {string | URL} url @param {string | string[]} [protocols] */
    constructor(url, protocols) {
      super(url, protocols);
      attach(/** @type {WebSocket} */ (/** @type {unknown} */ (this)));
    }
  };

  /* ---------------- relay ---------------- */

  function readToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
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
      const res = await fetch(`${ORIGIN}/api/espn/bridge/frames`, {
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

  function tick() {
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

  setInterval(tick, FLUSH_MS);
  // Only once paired: an unpaired bridge has no business calling ESPN's API on the user's behalf.
  if (onDraftPage && token) void readLeagueSettings();

  /* ---------------- pairing ---------------- */

  function pair() {
    const url = `${ORIGIN}/espn/pair?league=${encodeURIComponent(espnLeagueId)}&team=${espnTeamId}&season=${season}`;
    w.open(url, "warroom-pair", "popup,width=520,height=720");
  }

  w.addEventListener("message", (/** @type {MessageEvent} */ e) => {
    if (e.origin !== ORIGIN || !e.data || e.data.type !== "warroom-bridge-paired" || typeof e.data.token !== "string") return;
    writeToken(e.data.token);
    status = sockets ? "live" : "listening";
    lastPost = 0;
    render();
    if (onDraftPage) void readLeagueSettings();
    void flush();
  });

  /* ---------------- overlay ---------------- */

  const host = document.createElement("div");
  host.setAttribute("data-warroom-bridge", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    .box{position:fixed;left:16px;bottom:16px;z-index:2147483647;font:13px/1.35 system-ui,sans-serif;color:#e8edf2;
      background:#10161d;border:1px solid #2b3a48;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35);
      width:min(360px,calc(100vw - 32px));box-sizing:border-box}
    .t{font-weight:700;letter-spacing:.02em;margin-bottom:2px}.t i{font-style:normal;color:#5fd38d}
    .s{color:#aab7c4}.row{display:flex;gap:8px;margin-top:8px}
    button{font:inherit;border-radius:6px;border:1px solid #2b3a48;background:#1b2530;color:inherit;padding:4px 10px;cursor:pointer}
    button.go{background:#2e7d4f;border-color:#2e7d4f}[hidden]{display:none}
    .plan{margin-top:8px;border-top:1px solid #2b3a48;padding-top:8px}
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
    .note{color:#8f9aa8;font-size:12px;margin-top:6px}
  </style><div class="box"><div class="t">War Room <i>●</i></div><div class="s"></div>
  <div class="plan" hidden><div class="ph"><b class="pt"></b><span class="pr"></span><button class="more" type="button">More</button></div>
  <div class="rows"></div><div class="note"></div></div>
  <div class="row"><button class="go" type="button">Connect to War Room</button><button class="x" type="button">Hide</button></div></div>`;
  const statusEl = /** @type {HTMLElement} */ (root.querySelector(".s"));
  const dotEl = /** @type {HTMLElement} */ (root.querySelector(".t i"));
  const goEl = /** @type {HTMLButtonElement} */ (root.querySelector(".go"));
  const hideEl = /** @type {HTMLButtonElement} */ (root.querySelector(".x"));
  const planEl = /** @type {HTMLElement} */ (root.querySelector(".plan"));
  const planTitleEl = /** @type {HTMLElement} */ (root.querySelector(".pt"));
  const planRoundEl = /** @type {HTMLElement} */ (root.querySelector(".pr"));
  const moreEl = /** @type {HTMLButtonElement} */ (root.querySelector(".more"));
  const rowsEl = /** @type {HTMLElement} */ (root.querySelector(".rows"));
  const noteEl = /** @type {HTMLElement} */ (root.querySelector(".note"));
  goEl.onclick = pair;
  hideEl.onclick = () => (host.hidden = true);
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
    const live = !!token && sockets > 0 && onDraftPage;
    planEl.hidden = !live;
    if (!live) return;
    if (!plan) {
      planTitleEl.textContent = "Your turn plan";
      planRoundEl.textContent = "";
      moreEl.hidden = true;
      rowsEl.replaceChildren();
      noteEl.textContent = "Open your War Room board to see your turn plan here.";
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

  const picks = () => log.filter((f) => f.startsWith("SELECTED ")).length;

  function render() {
    if (armed !== null && !myTurn()) armed = null;
    const needsPairing = !token && onDraftPage;
    goEl.hidden = !needsPairing;
    goEl.textContent = status === "expired" ? "Connect again" : "Connect to War Room";
    let text;
    if (!onDraftPage) text = "Open your ESPN draft room, then click the War Room bookmark again.";
    else if (status === "expired") text = "Your War Room connection expired.";
    else if (status === "denied") text = "ESPN live sync isn't available on this War Room account yet.";
    else if (status === "purchase") text = "This league needs a War Room season pass for live sync.";
    else if (!token) text = "Connect this draft to your War Room board.";
    else if (status === "offline") text = "Can't reach War Room. Retrying…";
    else if (!sockets) text = "Connected. Waiting for ESPN's draft room…";
    else text = `Live · ${picks()} picks synced. Keep this tab open.`;
    statusEl.textContent = text;
    dotEl.style.color = token && sockets && status !== "offline" ? "#5fd38d" : "#e0a100";
    renderPlan();
  }

  (document.body || document.documentElement).appendChild(host);
  render();
  if (token) void flush();

  w.__warRoomBridge = {
    show() {
      host.hidden = false;
      render();
    },
    /** For tests and support: what the bridge is doing. */
    state: () => ({ status, sent, frames: log.length, sockets, paired: !!token, onDraftPage, planVersion, armed, drafting: draftingName }),
    /** Exposed so the INIT decoder can be run against blobs recorded from real drafts (8.12). */
    decodeInitPicks,
  };
})();
