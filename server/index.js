// ============================================================================
// PIT WALL — server entrypoint.
//
// One lean Node process serving BOTH:
//   • the static dashboard (web/) over HTTP
//   • the live event stream + transport controls over WebSocket
// on a single port (config.port, default 8080). No database; the disk recorder is
// the only persistence. Designed for the RAM-constrained NAS — no framework.
//
// Data flow:  source → (decode/normalize for real feed) → DelayBuffer → WS clients
// The buffer holds events and releases them `offset` seconds behind live, frozen on
// pause. See server/buffer/delayBuffer.js for the core mechanism.
// ============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { config } from './config.js';
import { log } from './logger.js';
import { DelayBuffer } from './buffer/delayBuffer.js';
import { handleControl } from './control/index.js';
import { Recorder } from './recorder/index.js';
import { SimSource } from './sources/simSource.js';
import { ReplaySource } from './sources/replaySource.js';
import { SignalRSource } from './signalr/client.js';
import { normalize } from './normalize/index.js';
import { isCompressed, inflateRaw } from './decode/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');

// ---- Health snapshot (served at /healthz) ---------------------------------
const health = {
  source: config.source,
  feedConnected: false,
  lastEventAt: null,
  clients: 0,
};

// ---- WebSocket fan-out ------------------------------------------------------
let wss; // set after the HTTP server is up
function broadcast(obj) {
  if (!wss) return;
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

// ---- Catch-up cache ---------------------------------------------------------
// The buffer broadcasts each event exactly once, so a browser that connects (or
// refreshes) mid-session would miss the roster and all current state until new
// patches happen to arrive. Remember the LAST RELEASED event per type (and per
// driver for per-driver types) and replay them to each new client. Spoiler-safe by
// construction: only events already released at the playback head are cached.
const lastReleased = new Map(); // "type:num" → event
const RC_KEEP = 40;             // race-control messages kept for catch-up
const rcReleased = [];
function cacheReleased(event) {
  if (event.type === 'transport' || event.type === 'seek') return;
  if (event.type === 'raceControl') {
    rcReleased.push(event);
    if (rcReleased.length > RC_KEEP) rcReleased.shift();
    return;
  }
  const num = event.payload && typeof event.payload === 'object' ? event.payload.num : undefined;
  lastReleased.set(`${event.type}:${num ?? ''}`, event);
}
function sendCatchUp(socket) {
  for (const event of lastReleased.values()) socket.send(JSON.stringify(event));
  for (const event of rcReleased) socket.send(JSON.stringify(event));
}

// ---- The delay buffer: releases events to the browser, offset behind live ---
const buffer = new DelayBuffer({
  maxSeconds: config.delayMaxSeconds,
  startOffsetSeconds: config.delayStartSeconds,
  onRelease: (event) => { cacheReleased(event); broadcast(event); }, // released event → all browsers
  onState: (state) => broadcast(state),            // transport state → all browsers
});
// Tick the buffer ~20x/sec: advances the playback head and releases due events.
const tickTimer = setInterval(() => buffer.tick(), 50);

// ---- Ingest: push every incoming normalized event into the buffer ----------
function ingest(event) {
  health.lastEventAt = Date.now();
  buffer.push(event);
}

// ---- Recorder (raw stream → disk, for the replay corpus) -------------------
const recorder = new Recorder({ dir: config.recordDir, enabled: config.recordRaw });

// ---- Select and start the data source --------------------------------------
let source;
function startSource() {
  if (config.source === 'signalr') {
    // Real feed. The adapter emits raw topic messages; we decode → normalize → ingest.
    source = new SignalRSource({
      config: config.signalr,
      onRaw: (raw, topic) => recorder.write(topic || 'unknown', raw),
      onHealth: (h) => {
        health.feedConnected = Boolean(h.connected);
        health.feed = h; // mode / reason detail for /healthz
      },
      onMessage: ({ topic, data, ingestTime }) => {
        try {
          const decoded = typeof data === 'string' && isCompressed(topic) ? inflateRaw(data) : data;
          for (const ev of normalize({ topic, data: decoded, ingestTime })) ingest(ev);
        } catch (err) {
          log.error('Failed to process feed message', { topic, error: String(err) });
        }
      },
    });
    source.start();
  } else if (config.source === 'replay') {
    source = new ReplaySource({ file: config.replayFile, speed: config.replaySpeed, emit: ingest });
    health.feedConnected = true;
    source.start();
  } else {
    // Default: the built-in sim, so the skeleton runs with no feed.
    source = new SimSource((ev) => ingest(ev));
    health.feedConnected = true;
    source.start();
    log.info('Running with the built-in SIM source (SOURCE=sim). Set SOURCE=signalr for the live feed.');
  }
}

// ---- HTTP server: static dashboard + /healthz ------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      ...health,
      clients: wss ? wss.clients.size : 0,
      transport: buffer.state(),
      lastEventAgeMs: health.lastEventAt ? Date.now() - health.lastEventAt : null,
    }));
    return;
  }

  // Static files from web/. Default to the dashboard.
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(WEB_DIR, path.normalize(rel));
  // Prevent path traversal outside web/.
  if (!filePath.startsWith(WEB_DIR)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      // Always revalidate: a stale cached dashboard silently runs the old demo
      // simulator instead of the live feed — worth a tiny request per load.
      'cache-control': 'no-cache',
    });
    res.end(buf);
  });
});

// ---- WebSocket: send events out, receive transport commands in -------------
wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket) => {
  health.clients = wss.clients.size;
  log.info('Dashboard connected', { clients: wss.clients.size });
  // Send the current transport state immediately so the UI reflects reality on
  // load, then the catch-up cache so a mid-session (re)connect isn't blank.
  socket.send(JSON.stringify(buffer.state()));
  sendCatchUp(socket);
  socket.on('message', (raw) => handleControl(buffer, raw.toString()));
  socket.on('close', () => { health.clients = wss.clients.size; });
  socket.on('error', (err) => log.warn('WS client error', { error: String(err) }));
});

// ---- Boot -------------------------------------------------------------------
server.listen(config.port, () => {
  log.info(`Pit Wall listening on http://0.0.0.0:${config.port}`, { source: config.source });
  log.info(`Dashboard: http://localhost:${config.port}  ·  Health: http://localhost:${config.port}/healthz`);
  startSource();
});

// ---- Graceful shutdown ------------------------------------------------------
function shutdown() {
  log.info('Shutting down…');
  clearInterval(tickTimer);
  try { source && source.stop && source.stop(); } catch {}
  recorder.close();
  for (const c of wss.clients) c.terminate();
  server.close(() => process.exit(0));
  // Hard exit if close hangs.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// A stray rejection must never kill the process — the feed is inherently flaky.
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', { error: String(err) }));
process.on('uncaughtException', (err) => log.error('Uncaught exception', { error: String(err) }));
