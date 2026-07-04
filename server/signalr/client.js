// ============================================================================
// F1 LIVE TIMING SignalR ADAPTER  —  ⚠️ STUB. Fable 5 implements this.
//
// This is the ONE place that touches the reverse-engineered, undocumented,
// volatile F1 feed. Everything downstream (decode → normalize → buffer → WS)
// consumes a clean internal event schema, so all feed fragility stays quarantined
// here. When F1 changes the endpoint/auth again (as they did at the 2025 Dutch GP),
// this file is the only thing that should need to change.
//
// It emits raw topic messages via `onMessage({ topic, data, ingestTime })`.
// `data` is the already-inflated JSON object for compressed topics, or the parsed
// JSON for the rest — do the DEFLATE in server/decode/ and call it from here, or
// inflate inline; either is fine as long as onMessage gets usable objects.
//
// PROTOCOL NOTES (verified — see reference/research-report.json):
//
//  CORE endpoint (current, since ~2025 Dutch GP):
//    wss://livetiming.formula1.com/signalrcore  (+ /signalrcore/negotiate)
//    ASP.NET Core SignalR. May require an F1-account auth token (config.signalr.authToken).
//
//  CLASSIC endpoint (legacy fallback):
//    https://livetiming.formula1.com/signalr
//    Hub "Streaming", method "Subscribe". Flow:
//      1) GET /signalr/negotiate?connectionData=[{"name":"Streaming"}]&clientProtocol=1.5
//         → returns { ConnectionToken, ... } and a Set-Cookie you must echo back.
//      2) Open ws /signalr/connect?transport=webSockets&connectionToken=…&connectionData=…
//      3) Send: { H:"Streaming", M:"Subscribe", A:[ TOPICS ], I:1 }
//      4) Receive an initial full snapshot per topic, then incremental "delta" patches.
//
//  Study these implementations before writing (do NOT reinvent the wire format):
//    • theOehrly/Fast-F1  → fastf1/livetiming/client.py   (canonical)
//    • matteocelani/f1-telemetry (Node/Next.js, SignalR→WS, 50ms batching)
//    • Troftu/F1-SignalR  (minimal reference)
//
//  Requirements:
//    • Auto-reconnect with exponential backoff.
//    • Heartbeat watchdog → mark unhealthy if no Heartbeat for N seconds.
//    • Never throw on a malformed message; log and continue.
//    • Record the raw pre-decode text via the recorder (server/recorder) so a real
//      session becomes a replay corpus.
// ============================================================================

import { log } from '../logger.js';
import { TOPICS } from './topics.js';

export class SignalRSource {
  /**
   * @param {object} opts
   * @param {object} opts.config                      config.signalr
   * @param {(msg:{topic:string,data:any,ingestTime:number})=>void} opts.onMessage
   * @param {(raw:string)=>void} [opts.onRaw]         raw text for the recorder
   * @param {(health:object)=>void} [opts.onHealth]
   */
  constructor({ config, onMessage, onRaw = () => {}, onHealth = () => {} }) {
    this.config = config;
    this.onMessage = onMessage;
    this.onRaw = onRaw;
    this.onHealth = onHealth;
    this.connected = false;
  }

  async start() {
    // TODO(Fable 5): implement the negotiate → connect → Subscribe(TOPICS) flow for
    // config.mode ('core' | 'classic'), inflate CarData.z/Position.z (raw DEFLATE),
    // merge deltas, and call this.onMessage({ topic, data, ingestTime: Date.now() })
    // for each. Call this.onRaw(rawText) for the recorder. Reconnect with backoff.
    log.warn('SignalRSource is a stub — no live feed yet. Implement server/signalr/client.js.', {
      mode: this.config.mode,
      url: this.config.mode === 'classic' ? this.config.classicUrl : this.config.coreUrl,
      topics: TOPICS.length,
      hasAuthToken: Boolean(this.config.authToken),
    });
    this.onHealth({ source: 'signalr', connected: false, reason: 'not-implemented' });
    // Intentionally does not connect. Run with SOURCE=sim until this is built.
  }

  async stop() {
    this.connected = false;
  }
}
