// Central configuration, all overridable via environment variables.
// Keeping every tunable in one place makes the Docker/NAS deployment simple:
// the compose file just sets env vars — no code changes needed.

function num(name, fallback) {
  // Parse an env var as a number, falling back if unset or invalid.
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export const config = {
  // HTTP + WebSocket port (one port serves both the dashboard and the live feed).
  port: num('PORT', 8080),

  // Which data source feeds the buffer:
  //   'sim'     — built-in fake race generator (default; lets the skeleton run with no feed).
  //   'signalr' — the real F1 Live Timing feed (Fable 5 implements server/signalr/client.js).
  //   'replay'  — replay a recorded raw stream file (set REPLAY_FILE).
  source: process.env.SOURCE || 'sim',

  // Delay buffer limits. DELAY_MAX_SECONDS caps how far behind live you can hold the view.
  delayMaxSeconds: num('DELAY_MAX_SECONDS', 300), // 5 minutes, matches the plan
  delayStartSeconds: num('DELAY_START_SECONDS', 0),

  // Raw-stream recorder: append every inbound message to disk for a replay corpus.
  recordRaw: bool('RECORD_RAW', true),
  recordDir: process.env.RECORD_DIR || './recordings',

  // Real feed (used by the SignalR adapter Fable 5 will build).
  signalr: {
    // The feed migrated classic → ASP.NET Core around the 2025 Dutch GP.
    // 'auto' (default) alternates between endpoints until one delivers data;
    // 'core' pins wss://livetiming.formula1.com/signalrcore; 'classic' the legacy one.
    mode: process.env.F1_SIGNALR_MODE || 'auto',
    coreUrl: process.env.F1_CORE_URL || 'wss://livetiming.formula1.com/signalrcore',
    classicUrl: process.env.F1_CLASSIC_URL || 'https://livetiming.formula1.com/signalr',
    // Optional F1-account auth token, if the core endpoint requires it.
    authToken: process.env.F1_AUTH_TOKEN || null,
  },

  // Replay source file (when SOURCE=replay).
  replayFile: process.env.REPLAY_FILE || null,
  replaySpeed: num('REPLAY_SPEED', 1),
};
