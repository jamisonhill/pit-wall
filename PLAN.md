# Pit Wall — Live F1 Telemetry Dashboard · Implementation Plan

**Goal:** A verbose, visual F1 telemetry dashboard you run on the home NAS and view in a
browser on your Mac. It ingests the **official F1 Live Timing SignalR feed**, holds the
data in a **delay buffer**, and lets you **manually start, pause, and time-shift** the
dashboard so it stays in sync with the race on your TV — without spoilers.

Grounded in verified research (`reference/research-report.json`) and a working UX demo
(`reference/dashboard-demo.html`).

---

## 1. Chosen approach

- **Data source:** direct F1 Live Timing **SignalR** feed (free, the true source that powers
  the official timing screens). Not OpenF1, not FastF1.
  - Legacy: `https://livetiming.formula1.com/signalr` — hub `Streaming`, method `Subscribe`.
  - Current: `wss://livetiming.formula1.com/signalrcore` (+ `/negotiate`). F1 migrated to
    ASP.NET Core SignalR around the **2025 Dutch GP**, and it may require an **F1-account
    login/token**. The client must handle both and fail gracefully.
  - ~20 subscribable topics; `CarData.z` and `Position.z` are **raw-DEFLATE-compressed**.
- **Why not FastF1:** its live client only *records raw text for post-session processing* —
  it explicitly cannot process data live. Useless for a live dashboard (but great for a
  replay/testing corpus — see §7).
- **Trade-off accepted:** this feed is **undocumented, reverse-engineered, and volatile**.
  The design must isolate all fragility behind one adapter and degrade gracefully.
- **Legal note (unresolved):** research found no source confirming personal use is
  sanctioned by F1's terms. This is a personal, non-commercial, single-viewer tool. Treat
  it as such; don't redistribute the stream.

---

## 2. Architecture

```
  F1 Live Timing (SignalR)                    HOME NAS (Docker)                          Your Mac
 ┌────────────────────────┐   wss    ┌──────────────────────────────────────┐   ws     ┌─────────────┐
 │ livetiming.formula1.com│ ───────► │  INGEST + DELAY SERVICE  (Node.js)   │ ───────► │  Browser    │
 │  signalrcore /signalr  │          │                                       │  :8080   │  dashboard  │
 │  CarData.z Position.z  │          │  negotiate → connect → Subscribe([…]) │          │  (the demo, │
 │  TimingData Weather …  │          │  DEFLATE-decode .z channels           │          │   wired to  │
 └────────────────────────┘          │  normalize → timestamped events       │  http    │   live ws)  │
                                      │  ┌─────────────────────────────────┐  │  :8080   │             │
                                      │  │ DELAY BUFFER (time-ordered queue)│  │ ◄──────► │  transport  │
                                      │  │  release msg at t + offset       │  │ controls │  controls   │
                                      │  │  start · pause · offset · scrub  │  │          └─────────────┘
                                      │  └─────────────────────────────────┘  │
                                      │  raw stream → disk (replay corpus)    │
                                      └──────────────────────────────────────┘
```

**Two independent clocks — this is the core idea:**
1. **Ingest clock** — real time. The service is always as live as the feed allows; every
   message is stamped with its arrival time and appended to a rolling buffer + disk log.
2. **Playback clock** — what the browser shows. It trails the ingest edge by your
   **offset** (e.g. −52s), and **freezes when you pause** while ingest keeps filling the
   buffer. This is exactly the mechanism in the demo's bottom transport bar.

"Start when the race starts" = begin ingest + start the playback clock at lights-out.
"Sync to TV" = increase offset until the timing tower matches your screen.
"Pause" = freeze the playback clock (buffer keeps growing; resume continues time-shifted).

---

## 3. Components

### 3a. Ingest + delay service (Node.js, single process)
- **SignalR client:** negotiate → open websocket → `Subscribe` to the topic list. Support
  both the classic and core endpoints; carry optional F1 auth token via env var.
- **Decoder:** raw DEFLATE (`zlib.inflateRawSync`) for `*.z` channels; JSON for the rest.
  Merge the SignalR "delta" model (initial full snapshot + incremental patches) into a
  coherent live state per driver.
- **Normalizer:** map raw topics → a stable internal event schema the frontend consumes
  (so the frontend never sees SignalR quirks). One event shape regardless of source.
- **Delay buffer:** in-memory time-ordered queue of normalized events (cap ~5 min).
  A release loop emits each event to connected browsers once
  `now − event.ingestTime ≥ offset` and playback isn't paused. Supports jump-to-live,
  scrub, and offset changes without dropping the connection.
- **Control channel:** browser → service commands `{start, pause, resume, setOffset, jumpLive, scrub}`.
- **Disk recorder:** append raw stream to a timestamped file → free replay corpus for
  building/testing on non-race-days (see §7). Also a spoiler-safe "watch later" mode.
- **Health:** auto-reconnect with backoff; heartbeat topic watchdog; `/healthz` endpoint.

### 3b. Frontend dashboard (browser, static)
- **Start from `reference/dashboard-demo.html`** — the layout, styling, timing semantics
  (purple=fastest, green=personal best), track map, telemetry gauges/charts, race-control
  feed, and the transport bar are already built and approved. Replace the internal
  simulator with a WebSocket client to the service; keep the exact same render functions
  and controls.
- **Panels:** timing tower (all 20, gaps/intervals, tyre + age, last lap, DRS/PIT) · live
  track map from `Position.z` GPS · selected-driver telemetry (speed/throttle/brake/gear/
  RPM/DRS) with scrolling traces · sector/segment timing · race control feed · weather ·
  lap/flag/session header.
- **Transport bar (the hero):** Start · Pause/Resume · TV-Sync offset ±5s (and ±1s) ·
  buffer depth meter · drag-to-scrub · Jump to Live. Keyboard: space = pause, arrows = offset.

### 3c. Deploy (NAS)
- Matches your existing pattern: **`ghcr.io/jamisonhill/<img>:latest` + Watchtower** auto-update.
- One small container (Node serves both the WebSocket and the static frontend on one port,
  e.g. `:8080`). Constraint: NAS is **x86_64, ~3.7GB RAM** — keep it a single lean Node
  process; **no Python/pandas**.
- Access from the Mac at the NAS address on port 8080. Optional Heimdall tile +
  Cloudflare tunnel later (both already on the NAS).

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Ingest/service | **Node.js 20** + `ws` | Matches the proven `matteocelani/f1-telemetry` path (SignalR→WS); light on RAM; native `zlib` DEFLATE |
| SignalR | hand-rolled client (negotiate + ws) | No maintained JS SignalR-classic lib for this; reference FastF1 `client.py` + `Troftu/F1-SignalR` |
| Frontend | **static HTML/CSS/vanilla JS** (the demo) | Already built; zero build step; trivial to serve |
| Container | Docker, single image | Your NAS standard |
| CI/CD | GitHub Actions → ghcr.io → Watchtower | Your existing auto-deploy |

Deliberately **no framework** on the frontend and **no database** — the disk log is the
only persistence needed.

---

## 5. Reference implementations (point Fable 5 at these)

- `theOehrly/Fast-F1` → `fastf1/livetiming/client.py` — canonical topic list, endpoints,
  negotiate flow, DEFLATE handling (Python, but the protocol truth).
- `matteocelani/f1-telemetry` — Next.js/Node decoding SignalR → WebSockets, **50ms
  batching**, `ws://localhost:8080`, and a **broadcast-delay** feature (up to 3 min). Closest
  architectural twin.
- `JustAman62/undercut-f1` — .NET TUI; its delay UX (~50s, nudged 1/5/30s) is the model for
  the transport bar.
- `Troftu/F1-SignalR` — minimal independent SignalR reference.

---

## 6. Milestones

1. **Skeleton** — repo, Dockerfile, ghcr Actions workflow, Node service serving the demo
   static file. Deploy to NAS; confirm port 8080 on the NAS loads the demo.
2. **Ingest** — SignalR connect + Subscribe + DEFLATE decode; log raw stream to disk.
   Validate against a live session (or replay corpus).
3. **Normalize** — raw topics → internal event schema; per-driver state merge.
4. **Delay engine** — buffer + release loop + control channel; wire the transport bar.
5. **Wire the frontend** — swap simulator for the live WS; map every panel to real fields.
6. **Harden** — reconnect/backoff, auth-token support, graceful "no session" state, replay mode.
7. **Polish** — Heimdall tile, optional Cloudflare tunnel, README/runbook.

---

## 7. Testing without a live race

Race days are rare, so the build **cannot** depend on one:
- **Replay corpus:** the disk recorder (§3a) captures a full real session once; feed it back
  through the delay engine at 1× to develop against realistic data any day.
- **FastF1** can also produce a recorded raw file for a past session as an offline corpus.
- The **simulator** already in the demo stays as a `--sim` mode for pure-offline UI work.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Feed auth/endpoint changes again (as it did at 2025 Dutch GP) | All SignalR quirks behind one adapter; support both endpoints; token via env; loud health/log on failure |
| DEFLATE/delta parsing edge cases | Build against the replay corpus; reference FastF1's exact handling |
| NAS RAM (3.7GB) | Single lean Node process; cap buffer ~5min; no pandas/framework |
| ToS ambiguity | Personal, single-viewer, non-redistributed; don't publicly expose the raw stream |
| Data ≠ TV timing drifts over a stint | Manual offset nudge is always available; that's the whole point of the transport bar |

---

## 9. What you do next

Hand `FABLE5_PROMPT.md` to Fable 5. It is self-contained: it carries the architecture
above, the verified feed specifics, the NAS deploy constraints, and points Fable 5 at the
demo as the frontend + UX spec. Build order = the milestones in §6.
