// ============================================================================
// F1 LIVE TIMING SignalR ADAPTER
//
// This is the ONE place that touches the reverse-engineered, undocumented,
// volatile F1 feed. Everything downstream (decode → normalize → buffer → WS)
// consumes a clean internal event schema, so all feed fragility stays quarantined
// here. When F1 changes the endpoint/auth again (as they did at the 2025 Dutch GP),
// this file is the only thing that should need to change.
//
// Two wire protocols are supported (see reference/research-report.json and
// FastF1's fastf1/livetiming/client.py, the protocol truth):
//
//  CORE (current, since ~2025 Dutch GP) — ASP.NET Core SignalR:
//    1) POST https://…/signalrcore/negotiate?negotiateVersion=1  → { connectionToken }
//    2) open wss://…/signalrcore?id=<token>
//    3) send the JSON-protocol handshake {"protocol":"json","version":1}<RS>
//    4) send invocation { type:1, target:"Subscribe", arguments:[TOPICS] }
//    Records are <RS>-separated JSON: type 1 = "feed" invocation [topic, data, utc],
//    type 3 = completion carrying the initial per-topic snapshot, type 6 = ping.
//    May require an F1-account token → sent as Authorization header AND as the
//    standard `access_token` query param (ASP.NET Core reads either).
//
//  CLASSIC (legacy fallback) — ASP.NET SignalR, hub "Streaming":
//    1) GET https://…/signalr/negotiate?connectionData=[{"name":"Streaming"}]
//       &clientProtocol=1.5  → { ConnectionToken } + Set-Cookie to echo back
//    2) open wss://…/signalr/connect?transport=webSockets&connectionToken=…
//    3) send { H:"Streaming", M:"Subscribe", A:[TOPICS], I:1 }
//    Frames are single JSON objects: {R:{…}} = snapshot reply, {M:[{M:"feed",
//    A:[topic,data,utc]}]} = deltas, {} = keepalive.
//
// In both protocols each topic delivers one full snapshot, then incremental
// patches. `CarData.z` / `Position.z` payloads are base64 raw-DEFLATE strings —
// passed through untouched; decode/normalize handle inflation downstream.
//
// Resilience: auto-reconnect with capped exponential backoff; in mode 'auto' the
// endpoints alternate between attempts until one delivers data; a watchdog kills
// silent connections; malformed messages are logged and dropped, never thrown.
// ============================================================================

import WebSocket from 'ws';
import { log } from '../logger.js';
import { TOPICS } from './topics.js';

const RS = ''; // ASP.NET Core SignalR record separator

// The official clients identify as BestHTTP (a Unity HTTP lib); mirroring it is
// the proven-safe choice from FastF1.
const BASE_HEADERS = { 'User-Agent': 'BestHTTP', 'Accept-Encoding': 'gzip,identity' };

const MAX_BACKOFF_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 10_000;
const STALE_AFTER_MS = 60_000; // no frames (not even keepalives/pings) → reconnect

export class SignalRSource {
  /**
   * @param {object} opts
   * @param {object} opts.config                      config.signalr
   * @param {(msg:{topic:string,data:any,ingestTime:number})=>void} opts.onMessage
   * @param {(raw:string,topic:string)=>void} [opts.onRaw]  pre-decode text for the recorder
   * @param {(health:object)=>void} [opts.onHealth]
   */
  constructor({ config, onMessage, onRaw = () => {}, onHealth = () => {} }) {
    this.config = config;
    this.onMessage = onMessage;
    this.onRaw = onRaw;
    this.onHealth = onHealth;

    this.ws = null;
    this.stopped = false;
    this.connected = false;
    this.attempt = 0;              // consecutive failed attempts (drives backoff)
    this.lastFrameAt = 0;          // any frame at all, incl. keepalives
    this.gotData = false;          // has THIS connection delivered a topic message?
    this.activeMode = null;        // 'core' | 'classic' for the current attempt
    this.reconnectTimer = null;
    this.watchdog = null;
    this.coreBuffer = '';          // partial-record accumulator for the core protocol
  }

  async start() {
    this.stopped = false;
    this.watchdog = setInterval(() => this._checkStale(), WATCHDOG_INTERVAL_MS);
    this._connect();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdog);
    this._teardown('stopped');
  }

  // ---- Connection lifecycle -------------------------------------------------

  /** Pick which protocol this attempt uses. In 'auto', alternate until one works. */
  _pickMode() {
    const { mode } = this.config;
    if (mode === 'classic' || mode === 'core') return mode;
    return this.attempt % 2 === 0 ? 'core' : 'classic';
  }

  async _connect() {
    if (this.stopped) return;
    this.activeMode = this._pickMode();
    this.gotData = false;
    this.lastFrameAt = Date.now(); // watchdog baseline for this attempt
    log.info('SignalR: connecting', { mode: this.activeMode, attempt: this.attempt + 1 });
    try {
      if (this.activeMode === 'core') await this._connectCore();
      else await this._connectClassic();
    } catch (err) {
      log.error('SignalR: connection attempt failed', { mode: this.activeMode, error: String(err) });
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    this._teardown('reconnecting');
    this.attempt += 1;
    // Capped exponential backoff with jitter so a dead feed isn't hammered.
    const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS) * (0.75 + Math.random() * 0.5);
    log.info('SignalR: reconnecting', { inMs: Math.round(delay), nextMode: this._pickMode() });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  _teardown(reason) {
    this.connected = false;
    this.coreBuffer = '';
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.terminate(); } catch { /* already dead */ }
      this.ws = null;
    }
    this.onHealth({ source: 'signalr', connected: false, mode: this.activeMode, reason });
  }

  _checkStale() {
    // Covers both a live feed that went silent AND a socket that opened but never
    // delivered anything (keepalives/pings refresh lastFrameAt, so an idle-but-alive
    // connection is NOT considered stale).
    if (this.stopped || !this.ws) return;
    const silence = Date.now() - this.lastFrameAt;
    if (silence > STALE_AFTER_MS) {
      log.warn('SignalR: watchdog — feed silent, forcing reconnect', { silentMs: silence });
      this._scheduleReconnect();
    }
  }

  /** Wire the shared ws event handlers; `onFrame` is protocol-specific. */
  _attach(ws, onFrame) {
    this.ws = ws;
    ws.on('message', (buf) => {
      this.lastFrameAt = Date.now();
      try { onFrame(buf.toString()); }
      catch (err) { log.error('SignalR: bad frame dropped', { error: String(err) }); }
    });
    ws.on('close', (code) => {
      if (this.stopped) return;
      log.warn('SignalR: socket closed', { code });
      this._scheduleReconnect();
    });
    ws.on('error', (err) => log.error('SignalR: socket error', { error: String(err) }));
  }

  _markConnected() {
    this.connected = true;
    this.lastFrameAt = Date.now();
    this.onHealth({ source: 'signalr', connected: true, mode: this.activeMode });
  }

  // ---- CORE protocol (ASP.NET Core SignalR) -----------------------------------

  async _connectCore() {
    const wsUrl = this.config.coreUrl;                          // wss://…/signalrcore
    const httpBase = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const headers = { ...BASE_HEADERS };
    if (this.config.authToken) headers.Authorization = `Bearer ${this.config.authToken}`;

    const res = await fetch(`${httpBase}/negotiate?negotiateVersion=1`, { method: 'POST', headers });
    if (!res.ok) throw new Error(`core negotiate HTTP ${res.status}`);
    const negotiation = await res.json();
    const id = negotiation.connectionToken ?? negotiation.connectionId;
    if (!id) throw new Error('core negotiate returned no connection id');
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

    const params = new URLSearchParams({ id });
    // Browsers can't set ws headers, so ASP.NET Core also accepts the token as a
    // query param — send both forms since we don't control F1's middleware config.
    if (this.config.authToken) params.set('access_token', this.config.authToken);

    const ws = new WebSocket(`${wsUrl}?${params}`, {
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    });

    let handshaken = false;
    this._attach(ws, (text) => {
      // Core frames are <RS>-separated records and may split across ws messages.
      this.coreBuffer += text;
      const records = this.coreBuffer.split(RS);
      this.coreBuffer = records.pop(); // last piece is complete only if text ended in RS
      for (const record of records) {
        if (!record) continue;
        const msg = JSON.parse(record);
        if (!handshaken) {
          // First record is the handshake response: {} on success, {error} on failure.
          handshaken = true;
          if (msg.error) {
            log.error('SignalR: core handshake rejected', { error: msg.error });
            this._scheduleReconnect();
            return;
          }
          ws.send(JSON.stringify({ type: 1, invocationId: '1', target: 'Subscribe', arguments: [TOPICS] }) + RS);
          continue;
        }
        this._handleCoreRecord(msg);
      }
    });

    ws.on('open', () => {
      log.info('SignalR: core socket open, handshaking');
      ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS);
    });
  }

  _handleCoreRecord(msg) {
    switch (msg.type) {
      case 1: // invocation — the live "feed" stream: arguments = [topic, data, utc]
        if (msg.target === 'feed' && Array.isArray(msg.arguments)) {
          this._emitTopic(msg.arguments[0], msg.arguments[1]);
        }
        break;
      case 3: // completion of our Subscribe — result is the initial per-topic snapshot
        if (msg.result && typeof msg.result === 'object') this._emitSnapshot(msg.result);
        break;
      case 6: // ping — answer in kind so the server keeps the connection alive
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 6 }) + RS);
        break;
      case 7: // server-initiated close
        log.warn('SignalR: core server sent close', { error: msg.error });
        this._scheduleReconnect();
        break;
      default:
        break; // other record types carry nothing we need
    }
  }

  // ---- CLASSIC protocol (legacy ASP.NET SignalR) --------------------------------

  async _connectClassic() {
    const httpBase = this.config.classicUrl;                    // https://…/signalr
    const connectionData = encodeURIComponent(JSON.stringify([{ name: 'Streaming' }]));

    const res = await fetch(
      `${httpBase}/negotiate?connectionData=${connectionData}&clientProtocol=1.5`,
      { headers: BASE_HEADERS },
    );
    if (!res.ok) throw new Error(`classic negotiate HTTP ${res.status}`);
    const negotiation = await res.json();
    if (!negotiation.ConnectionToken) throw new Error('classic negotiate returned no ConnectionToken');
    // The negotiate cookie MUST be echoed on the websocket or the connect is refused.
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

    const wsBase = httpBase.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    const params = new URLSearchParams({
      transport: 'webSockets',
      clientProtocol: '1.5',
      connectionToken: negotiation.ConnectionToken,
      connectionData: JSON.stringify([{ name: 'Streaming' }]),
    });

    const ws = new WebSocket(`${wsBase}/connect?${params}`, {
      headers: { ...BASE_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
    });

    this._attach(ws, (text) => {
      const msg = JSON.parse(text);
      // {} keepalive frames land here too — they refresh lastFrameAt and nothing else.
      if (msg.R && typeof msg.R === 'object') this._emitSnapshot(msg.R); // Subscribe reply
      for (const item of msg.M ?? []) {
        if (item?.M === 'feed' && Array.isArray(item.A)) this._emitTopic(item.A[0], item.A[1]);
      }
    });

    ws.on('open', () => {
      log.info('SignalR: classic socket open, subscribing', { topics: TOPICS.length });
      ws.send(JSON.stringify({ H: 'Streaming', M: 'Subscribe', A: [TOPICS], I: 1 }));
    });
  }

  // ---- Shared emission ------------------------------------------------------------

  /** The initial full state for every topic, delivered once per (re)connect. */
  _emitSnapshot(snapshot) {
    log.info('SignalR: initial snapshot received', { topics: Object.keys(snapshot).length });
    for (const [topic, data] of Object.entries(snapshot)) this._emitTopic(topic, data);
  }

  /**
   * Forward one raw topic message downstream. `data` stays exactly as the feed sent
   * it: a base64 DEFLATE string for the *.z topics, a parsed JSON object otherwise —
   * decode/normalize own the interpretation. Also feeds the recorder in the exact
   * shape the replay source reads back.
   */
  _emitTopic(topic, data) {
    if (typeof topic !== 'string' || data === undefined) return;
    if (!this.gotData) {
      this.gotData = true;
      this.attempt = 0; // this endpoint works — future reconnects start fast again
      this._markConnected();
      log.info('SignalR: feed is delivering data', { mode: this.activeMode });
    }
    try {
      this.onRaw(typeof data === 'string' ? data : JSON.stringify(data), topic);
      this.onMessage({ topic, data, ingestTime: Date.now() });
    } catch (err) {
      // A downstream failure must never kill the socket handler.
      log.error('SignalR: downstream handler failed', { topic, error: String(err) });
    }
  }
}
