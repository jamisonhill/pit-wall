# Build prompt for Fable 5 — "Pit Wall" live F1 telemetry dashboard

> Copy everything below the line into Fable 5. It is self-contained. Two companion files
> live in this repo and are referenced by the prompt: `reference/dashboard-demo.html` (the
> working UX/layout to build the real frontend from) and `PLAN.md` (fuller architecture).

---

## Role & objective

You are building **Pit Wall**, a personal, single-viewer live Formula 1 telemetry dashboard.
It runs as a Docker container on a home Synology NAS and is viewed in a desktop browser. It
ingests the **official F1 Live Timing SignalR feed**, holds incoming data in a **delay
buffer**, and lets the user **manually start, pause, and time-shift** the dashboard so it
stays in sync with the race playing on their TV — with **no spoilers**.

This is a real, reverse-engineered data feed: **undocumented and volatile**. Isolate every
bit of that fragility behind a single adapter, and make the app degrade gracefully when the
feed is absent, changes shape, or a session isn't running. Correctness and resilience matter
more than feature count.

Build in the milestone order in "Delivery plan" below. Keep it runnable at every step.

---

## The data source (verified facts — treat as ground truth)

**F1 Live Timing SignalR feed** — the same stream that powers the official timing screens.

- **Legacy endpoint:** `https://livetiming.formula1.com/signalr`
  - Classic ASP.NET SignalR. Hub **`Streaming`**, invoke method **`Subscribe`** with the
    topic array. Connection flow: `GET /signalr/negotiate` (with
    `connectionData=[{"name":"Streaming"}]`) → open the websocket at `/signalr/connect` →
    send the `Subscribe` invocation.
- **Current endpoint:** `wss://livetiming.formula1.com/signalrcore` (+ `/signalrcore/negotiate`)
  - ASP.NET **Core** SignalR. F1 migrated here around the **2025 Dutch GP**, and it may now
    require an **F1-account auth token**. Support this endpoint and accept an auth token via
    env var; fall back to / also support the legacy endpoint.
- **Subscribe to these ~20 topics** (superset; subscribe to all, use what you need):
  `Heartbeat, CarData.z, Position.z, TimingData, TimingStats, TimingAppData, WeatherData,
  RaceControlMessages, TrackStatus, SessionInfo, SessionStatus, SessionData, DriverList,
  LapCount, ExtrapolatedClock, TopThree, RcmSeries, TeamRadio, AudioStreams, ContentStreams`.
- **Compression:** `CarData.z` and `Position.z` are **raw DEFLATE** (no zlib/gzip header).
  Decode with `zlib.inflateRawSync` (Node). All other topics are JSON text.
- **Delta model:** each topic sends an **initial full snapshot**, then **incremental patch**
  messages. Merge patches into a per-topic, per-driver running state.

**Field/schema reference** (from FastF1, authoritative for the decoded payloads):
- `CarData.z` → per driver, per sample (~few Hz): `Speed` (km/h, int), `RPM` (int),
  `nGear`/gear (int 0–8), `Throttle` (0–100), `Brake` (0/100 or bool), `DRS` (int code;
  values ≥8 generally mean available/open — verify against live data).
- `Position.z` → per driver: `X`, `Y`, `Z` in **1/10 metre** units + `Status` (OnTrack/OffTrack).
  Use X/Y for the live track map.
- `TimingData` → positions, `GapToLeader`, `IntervalToPositionAhead`, sector times +
  micro-sector **Segments** (each has a status code → colour), last/best lap, in/out lap,
  pit status.
- `TimingAppData` → **tyre compound** (Soft/Medium/Hard/Inter/Wet) and **stint / tyre age**.
- `TimingStats` → speed-trap bests (I1/I2/FL/ST) and session bests.
- `WeatherData` → air & track temp, wind speed/direction, humidity, pressure, **rainfall**.
- `RaceControlMessages` → flags, safety car / VSC, investigations, penalties, lap deletions,
  steward decisions (each with a lap, category, and message string).
- `TrackStatus` → green/yellow/SC/VSC/red flag state. `LapCount` → current/total laps.
- `SessionInfo`/`DriverList` → session + GP name, and the 20-car roster (number, code, team,
  colour) — use `DriverList` as the source of truth for names/teams/colours, not hardcoded.

**Do NOT use FastF1's live client to run the dashboard** — it only records raw text for
post-session processing and explicitly cannot process data live. (You may use it *offline*
to produce a recorded corpus for testing; see "Testing".)

**Reference implementations to study** (mirror their proven choices; don't reinvent the wire
protocol):
- `theOehrly/Fast-F1` → `fastf1/livetiming/client.py` — canonical topics, endpoints,
  negotiate flow, DEFLATE handling. The protocol truth.
- `matteocelani/f1-telemetry` — Next.js/Node monorepo decoding SignalR → WebSockets, **50ms
  batching**, rebroadcast on `ws://localhost:8080`, and a broadcast-delay buffer (up to 3
  min). Closest architectural twin — follow this shape.
- `JustAman62/undercut-f1` — .NET TUI whose delay UX (≈50s, nudged in 1/5/30s) models the
  transport bar.
- `Troftu/F1-SignalR` — minimal independent SignalR reference.

---

## Architecture (build exactly this shape)

**Two clocks.** (1) An **ingest clock** = real time: the service stays as live as the feed
allows and stamps every normalized event with its arrival time. (2) A **playback clock** =
what the browser renders, trailing the ingest edge by a user-set **offset** and **freezing
on pause** while ingest keeps filling the buffer. The whole TV-sync feature is this buffer.

```
F1 SignalR ──wss──► [ Node service: SignalR client → DEFLATE decode → normalize
                       → DELAY BUFFER (release each event at ingestTime+offset)
                       → WebSocket broadcast ]  ──ws + static http on :8080──►  Browser dashboard
                       └► raw stream to disk (replay corpus + watch-later)
```

### Backend — one lean Node.js 20 process (`server/`)
Single process, single exposed port (`:8080`) serving **both** the WebSocket and the static
frontend. No database. Modules:

1. **`signalr/` adapter** — negotiate → connect → `Subscribe`. Handles both endpoints, the
   optional auth token (env `F1_AUTH_TOKEN`), auto-reconnect with exponential backoff, and a
   Heartbeat watchdog. **All feed fragility lives here.**
2. **`decode/`** — raw-DEFLATE for `*.z`, JSON otherwise; merge initial+delta into running
   state per topic/driver.
3. **`normalize/`** — map raw topics → a **stable internal event schema** the frontend
   consumes, so the frontend never sees a SignalR quirk. Emit typed events:
   `carData, position, timing, tyres, weather, raceControl, trackStatus, session, driverList`.
   Each event: `{ type, ingestTime, sessionTime, payload }`.
4. **`buffer/` (the delay engine)** — time-ordered in-memory queue (cap ~5 min). A release
   loop forwards events to browsers once `now − event.ingestTime ≥ offset` **and** not paused.
   Supports live offset change, pause/resume, jump-to-live, and scrub — all without dropping
   client connections.
5. **`control/`** — accept browser commands over the same WS:
   `{ start, pause, resume, setOffset(seconds), jumpLive, scrub(toIngestTime) }`.
   Broadcast current transport state (offset, buffer depth, paused, live-edge) to all clients.
6. **`recorder/`** — append the raw stream to a timestamped file. Enables the **replay
   corpus** and a spoiler-safe watch-later mode.
7. **`/healthz`** — feed-connected? last-heartbeat age? session active? buffer depth?

### Frontend — static, framework-free (`web/`)
**Start from `reference/dashboard-demo.html` in this repo.** Its layout, dark pit-wall
styling, F1 timing colour semantics (**purple = fastest overall, green = personal best,
yellow = slower**, team colours for the categorical system), track map, telemetry
gauges/charts, race-control feed, weather, header, and the **bottom transport bar** are the
approved spec. Your job: **replace the internal simulator with a WebSocket client** to the
backend, keeping the same render functions and the same controls. Keep a `?sim=1` mode that
runs the old simulator for offline UI work.

Panels (all fed from the internal event schema):
- **Timing tower** — all 20 cars: position (+movement arrow), code/number, team stripe, tyre
  compound + age, interval/gap, last lap (colour-coded), DRS/PIT badges. Click a driver to pin.
- **Live track map** — dots from `Position.z` X/Y; highlight the pinned driver + leader;
  mark DRS zones and start/finish.
- **Selected-driver telemetry** — big speed/throttle/brake/gear/RPM/DRS readouts + scrolling
  traces (last ~7s) for speed, throttle/brake, gear.
- **Sector / micro-sector timing**, **race-control feed** (newest first, colour by category),
  **weather chip**, and a header with lap/flag/session clock.

### Transport bar (the hero control — get this right)
- **Start** (begin ingest + start playback clock), **Pause/Resume** (freeze playback clock;
  buffer keeps filling), **TV-Sync offset** −/+ in 5s and 1s steps with a big current-offset
  readout, a **buffer-depth meter**, **drag-to-scrub** across the buffer, and **Jump to Live**.
- Keyboard: `space` = pause/resume, arrows = offset ±. Show a clear state pill:
  `STANDBY → LIVE → DELAYED −52s → PAUSED`.
- The demo already implements all of this against the simulator — preserve the behaviour
  exactly, just drive it from the real buffer.

---

## NAS deployment (target environment — build for this)

- **Host:** Synology DS918+, **x86_64**, **~3.7GB RAM** (keep the process lean; **no Python/
  pandas**, no heavy framework). Docker via standalone `docker-compose`.
- **Pattern (match the user's existing setup):** GitHub repo → **GitHub Actions builds &
  pushes `ghcr.io/jamisonhill/pit-wall:latest`** → **Watchtower** on the NAS auto-updates the
  container within minutes of each push to `main`.
- Deliver:
  - `Dockerfile` — multi-stage, small final image (node:20-alpine), non-root user, exposes 8080.
  - `docker-compose.yml` — one service, restart `unless-stopped`, port `8080:8080`, a mounted
    volume for the raw-stream recordings, and env for `F1_AUTH_TOKEN`, `DELAY_MAX_SECONDS`,
    `PORT`.
  - `.github/workflows/deploy.yml` — build + push to ghcr on push to `main` (the user's
    standard flow; a Watchtower label on the compose service triggers auto-update).
  - `README.md` runbook: how to start on race day, set the offset, use replay mode, and read
    `/healthz`.
- Accessed from the Mac at the NAS address on port 8080. (Optional later: a Heimdall tile
  and a Cloudflare-tunnel route — both already run on this NAS.)

---

## Testing (must not depend on a live race)

- **Replay corpus:** use the recorder to capture one real session, then replay the raw file
  through the decode→normalize→buffer pipeline at 1× to develop against realistic data any
  day. Also accept a FastF1-produced recorded file as an alternate corpus.
- **`?sim=1`:** the demo's simulator stays available for pure-frontend work with no backend.
- Unit-test the DEFLATE decode, the delta-merge, and the delay-release loop (offset math,
  pause/resume, scrub bounds) against fixtures from the corpus.

---

## Constraints & non-goals

- **Personal, single-viewer, non-commercial.** Do not publicly expose or redistribute the raw
  F1 stream. No public internet exposure of the feed by default.
- **No account/multi-user, no database, no analytics backend.** One viewer, one screen.
- **Resilience over features:** a clean "waiting for session / feed unavailable" state beats a
  half-broken live view. Log feed failures loudly; never crash the process on a bad message.
- Keep the frontend dependency-free and buildless where possible; keep the backend to `ws` +
  Node stdlib (`zlib`, `http`, `crypto`) plus minimal, well-known deps only.

## Delivery plan (build in this order, runnable at each step)

1. **Skeleton** — repo, Dockerfile, ghcr Actions workflow, Node service serving
   `reference/dashboard-demo.html` (in `?sim=1`). Deploy to NAS; confirm `:8080` loads.
2. **Ingest** — SignalR connect + Subscribe + DEFLATE decode; record raw stream to disk.
3. **Normalize** — raw topics → internal event schema; per-driver state merge.
4. **Delay engine** — buffer + release loop + control channel; wire the transport bar to it.
5. **Wire frontend** — swap simulator for the live WS; map every panel to real fields.
6. **Harden** — reconnect/backoff, auth-token support, "no session" state, replay mode, tests.
7. **Polish** — README/runbook, optional Heimdall tile + Cloudflare route.

Deliver clean, commented, resilient code with a README that explains race-day operation.
