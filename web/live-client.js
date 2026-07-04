// ============================================================================
// LIVE CLIENT BRIDGE  —  ⚠️ Scaffold for Fable 5 (milestone 5).
//
// The dashboard (index.html) currently runs its own in-browser SIMULATOR. To go live,
// Fable 5 replaces that simulator's data with events from this WebSocket, WITHOUT
// touching the render functions or the transport-bar UI — they already exist and work.
//
// This file gives you:
//   • a resilient WS connection to the server (auto-reconnect)
//   • a decoded stream of normalized events (same schema as server/normalize)
//   • helpers to send transport commands the buttons already call
//   • the server's authoritative transport state (offset/buffer/paused) to drive the bar
//
// Integration sketch:
//   1) In index.html, guard the simulator behind `if (new URLSearchParams(location.search).has('sim'))`.
//   2) Otherwise, `const live = connectLive({...})` and feed `onEvent` into the same
//      per-driver state the simulator maintained, then let the existing render loop draw it.
//   3) Point the transport buttons at live.cmd.* instead of mutating local sim state, and
//      render the bar from `onTransport(state)` (server is the source of truth for offset/buffer).
// ============================================================================

export function connectLive({ onEvent, onTransport, onStatus } = {}) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let ws;
  let backoff = 500;
  // Commands issued while the socket is down (e.g. Safari suspends background
  // tabs and kills the connection; the user clicks Start right after waking the
  // tab, mid-reconnect). Queue a few and flush on open — never drop silently.
  const pending = [];
  const PENDING_MAX = 8;

  function open() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      backoff = 500; onStatus && onStatus('connected');
      while (pending.length) ws.send(pending.shift());
    };
    ws.onclose = () => {
      onStatus && onStatus('disconnected');
      // Reconnect with capped exponential backoff — the server may restart on deploy.
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 8000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      // The server sends transport state as {type:'transport', ...} and everything
      // else is a normalized event ({type, ingestTime, payload}).
      if (msg.type === 'transport') { onTransport && onTransport(msg); }
      else { onEvent && onEvent(msg); }
    };
  }
  open();

  function send(obj) {
    const data = JSON.stringify(obj);
    if (ws && ws.readyState === 1) ws.send(data);
    else {
      pending.push(data);
      if (pending.length > PENDING_MAX) pending.shift(); // keep the newest commands
    }
  }

  // These map 1:1 to the transport bar the demo already renders.
  const cmd = {
    start: () => send({ cmd: 'start' }),
    pause: () => send({ cmd: 'pause' }),
    resume: () => send({ cmd: 'resume' }),
    jumpLive: () => send({ cmd: 'jumpLive' }),
    setOffset: (seconds) => send({ cmd: 'setOffset', seconds }),
    nudgeOffset: (deltaSeconds) => send({ cmd: 'nudgeOffset', deltaSeconds }),
    scrubTo: (ingestTime) => send({ cmd: 'scrubTo', ingestTime }),
    // Switch the server's data source: {kind:'live'} or {kind:'replay', file}.
    setSource: (kind, file) => send({ cmd: 'setSource', kind, file }),
  };

  return { cmd, close: () => ws && ws.close() };
}
