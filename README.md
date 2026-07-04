# Pit Wall — live F1 telemetry dashboard

A personal, single-viewer F1 telemetry dashboard. It ingests the official F1 Live Timing
feed, holds the data in a **delay buffer**, and lets you **manually start, pause, and
time-shift** the dashboard so it stays in sync with the race on your TV — no spoilers.

Runs as one lean Node container on the home NAS; viewed in a browser on your Mac.

> **Status: feature-complete pipeline.** SignalR ingest (both endpoints), DEFLATE decode,
> delta merge, normalization, delay engine, recorder, replay, and the live-wired dashboard
> are all implemented and tested. What remains is validation against a real live session
> (the feed only exists on race weekends). See `PLAN.md` for the architecture.

---

## Run it locally (right now)

```bash
npm install
npm start
# open http://localhost:8080        (the dashboard)
# open http://localhost:8080/healthz (feed + transport status JSON)
npm test                            # unit tests: delay engine, decode, normalize
```

With no live feed, the server runs a built-in **sim** race so you can exercise the whole
pipeline — press **Start** in the dashboard to begin playback. The dashboard also has a
richer in-browser simulator at `http://localhost:8080/?sim=1` that needs no backend at all.

## What's built

| Piece | State |
|---|---|
| HTTP static serving + WebSocket server (`server/index.js`) | ✅ working, sends catch-up state to (re)connecting clients |
| **Delay engine** (`server/buffer/delayBuffer.js`) | ✅ working, unit-tested |
| Transport control channel (`server/control/`) | ✅ working |
| Raw-stream recorder (`server/recorder/`) | ✅ working |
| Sim + replay sources (`server/sources/`) | ✅ both working |
| **F1 SignalR adapter** (`server/signalr/client.js`) | ✅ both endpoints, auto fallback, backoff, watchdog — *awaits a live session for real-world validation* |
| **Decode** deltas / **Normalize** topics | ✅ implemented, unit-tested against feed-shaped fixtures |
| Dashboard UI (`web/index.html`) | ✅ live-wired to the server; simulator kept at `?sim=1` |

## Architecture (short)

```
F1 SignalR ──► [ signalr → decode → normalize → DelayBuffer → WebSocket ] ──► browser dashboard
                                                     └► raw stream → disk (replay corpus)
```

Two clocks: an **ingest clock** (real time, always as live as the feed) and a **playback
head** that trails the live edge by your chosen **offset** and freezes on pause. Full detail
in `PLAN.md`.

## Race-day operation

1. Start the container (or `npm start`) with `SOURCE=signalr`.
2. Open the dashboard on your Mac at `http://192.168.0.9:8080`.
3. At lights-out, hit **Start**.
4. Nudge **TV Sync Offset** (+5s / +1s) until the timing tower matches your TV (broadcast
   lags the data by ~30–60s).
5. **Pause/Resume** any time — the buffer keeps filling while paused, so you never lose data.
6. **Jump to Live** to snap back to the real-time edge.

## Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `SOURCE` | `sim` | `sim` \| `signalr` (live) \| `replay` (recorded file) |
| `PORT` | `8080` | HTTP + WebSocket port |
| `DELAY_MAX_SECONDS` | `300` | Max time-shift / buffer depth |
| `RECORD_RAW` | `true` | Append the raw feed to `RECORD_DIR` (builds a replay corpus) |
| `RECORD_DIR` | `./recordings` | Where recordings go |
| `F1_SIGNALR_MODE` | `auto` | `auto` (alternate until one works) \| `core` (current endpoint) \| `classic` (legacy) |
| `F1_AUTH_TOKEN` | — | F1-account token if the core endpoint requires it |
| `REPLAY_FILE` / `REPLAY_SPEED` | — / `1` | For `SOURCE=replay` |

## Deploy to the NAS

Matches your `ghcr.io/jamisonhill/*` + Watchtower pattern:

1. Push to `main` → GitHub Actions builds & pushes `ghcr.io/jamisonhill/pit-wall:latest`.
2. Copy `docker-compose.yml` to `/volume1/docker/pit-wall/` on the NAS and
   `docker-compose up -d`.
3. Watchtower auto-updates the container on subsequent pushes.
4. View at `http://192.168.0.9:8080`.

## Testing without a live race

Race days are rare. Record one real session (`RECORD_RAW=true`), then replay it any day:

```bash
SOURCE=replay REPLAY_FILE=./recordings/raw-YYYY-....ndjson npm start
```

The recording replays through the exact same decode → normalize → buffer pipeline at
original pacing (`REPLAY_SPEED` to speed it up), so it doubles as a spoiler-safe
"watch the race later" mode: replay at 1× and use the dashboard normally.

## Notes

- Personal, non-commercial, single-viewer. Don't publicly expose or redistribute the raw
  F1 stream — the feed is undocumented/reverse-engineered and its terms are unclear.
- The feed's endpoint/auth changed at the 2025 Dutch GP; all that volatility is quarantined
  in `server/signalr/client.js` by design.
