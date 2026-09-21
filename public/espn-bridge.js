// @ts-check
/**
 * War Room's ESPN draft bridge (Epic 8).
 *
 * A bookmarklet loads this into the user's own ESPN draft tab. It listens to the page's own draft
 * socket and relays the frames to War Room, which turns them into picks on the user's board.
 *
 * - Read-only: it never sends anything on ESPN's socket. The page's own sends pass through untouched.
 * - It forwards draft frames only, and strips what isn't draft data before anything leaves the tab:
 *   INIT (room state) and TOKEN (the user's ESPN id and join code) go as bare frame names, and every
 *   member GUID is zeroed. War Room never sees ESPN cookies or passwords.
 * - It authenticates to War Room with a pairing token from a popup on War Room's own site, because
 *   cross-site requests from espn.com don't carry War Room's session cookie.
 *
 * Plain script, no build step, so what's tested (src/lib/espn/bridge.test.ts) is exactly what ships.
 * The frame grammar is documented in docs/espn-protocol.md.
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

  /** Sanitized frames since the bridge attached, in order. */
  const log = /** @type {string[]} */ ([]);
  /** How many of them War Room has confirmed. */
  let sent = 0;
  let inFlight = false;
  let lastPost = 0;
  let failures = 0;
  let sockets = 0;
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

  const attached = new WeakSet();
  /** @param {WebSocket} ws */
  function attach(ws) {
    if (attached.has(ws) || !ESPN_SOCKET.test(String(ws.url))) return;
    attached.add(ws);
    sockets++;
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return;
      const frame = sanitize(e.data);
      if (frame) log.push(frame);
    });
    ws.addEventListener("close", () => {
      sockets = Math.max(0, sockets - 1);
      render();
    });
    render();
  }

  // Sockets opened before the click are caught on their next send (ESPN pings every 15s)...
  const proto = w.WebSocket.prototype;
  const send = proto.send;
  proto.send = function (/** @type {any} */ data) {
    attach(this);
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
    const frames = log.slice(sent, sent + MAX_BATCH);
    try {
      const res = await fetch(`${ORIGIN}/api/espn/bridge/frames`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ espnLeagueId, seq: sent, frames }),
      });
      if (res.status === 200 || res.status === 409) {
        // 409: War Room holds a different number of frames (e.g. it restarted); resend from there.
        const body = await res.json().catch(() => ({}));
        sent = typeof body.have === "number" ? Math.min(Math.max(0, body.have), log.length) : sent + frames.length;
        failures = 0;
        status = sockets ? "live" : "listening";
        if (res.status === 409) lastPost = 0;
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
  }

  setInterval(() => {
    if (!token) return;
    if (failures && Date.now() - lastPost < Math.min(30_000, HEARTBEAT_MS * failures)) return;
    void flush();
  }, FLUSH_MS);

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
    void flush();
  });

  /* ---------------- overlay ---------------- */

  const host = document.createElement("div");
  host.setAttribute("data-warroom-bridge", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    .box{position:fixed;left:16px;bottom:16px;z-index:2147483647;font:13px/1.35 system-ui,sans-serif;color:#e8edf2;
      background:#10161d;border:1px solid #2b3a48;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:280px}
    .t{font-weight:700;letter-spacing:.02em;margin-bottom:2px}.t i{font-style:normal;color:#5fd38d}
    .s{color:#aab7c4}.row{display:flex;gap:8px;margin-top:8px}
    button{font:inherit;border-radius:6px;border:1px solid #2b3a48;background:#1b2530;color:inherit;padding:4px 10px;cursor:pointer}
    button.go{background:#2e7d4f;border-color:#2e7d4f}[hidden]{display:none}
  </style><div class="box"><div class="t">War Room <i>●</i></div><div class="s"></div>
  <div class="row"><button class="go" type="button">Connect to War Room</button><button class="x" type="button">Hide</button></div></div>`;
  const statusEl = /** @type {HTMLElement} */ (root.querySelector(".s"));
  const dotEl = /** @type {HTMLElement} */ (root.querySelector(".t i"));
  const goEl = /** @type {HTMLButtonElement} */ (root.querySelector(".go"));
  const hideEl = /** @type {HTMLButtonElement} */ (root.querySelector(".x"));
  goEl.onclick = pair;
  hideEl.onclick = () => (host.hidden = true);

  const picks = () => log.filter((f) => f.startsWith("SELECTED ")).length;

  function render() {
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
    else text = `Live. Picks go to your board (${picks()} so far). Keep this tab open.`;
    statusEl.textContent = text;
    dotEl.style.color = token && sockets && status !== "offline" ? "#5fd38d" : "#e0a100";
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
    state: () => ({ status, sent, frames: log.length, sockets, paired: !!token, onDraftPage }),
  };
})();
