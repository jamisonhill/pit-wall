# Pit Wall — Progress

## Phase 1: Skeleton [DONE]
- [x] Repo, Dockerfile, ghcr Actions workflow
- [x] Node service serving the dashboard + WS on one port
- [x] Delay buffer engine + unit tests, control channel, recorder, sim/replay sources

## Phase 2: Ingest [DONE]
- [x] SignalR adapter — core + classic endpoints, auto fallback, backoff, watchdog
- [x] Raw-DEFLATE decode; raw stream recorded to disk
- [x] Validated against the REAL feed during 2026 British GP qualifying

## Phase 3: Normalize [DONE]
- [x] Delta-merge (nested/numeric-key patches, _kf)
- [x] All topics → typed internal events; unit-tested against feed-shaped fixtures

## Phase 4: Delay engine [DONE]
- [x] Buffer + release loop + transport commands (was largely done in skeleton)
- [x] reset() for source switching; state keyframes every 45s (prune-proof)

## Phase 5: Wire frontend [DONE]
- [x] Live mode default, simulator kept at ?sim=1
- [x] All panels fed from real fields; live track map from Position X/Y
- [x] Transport bar driven by server's authoritative state
- [x] Catch-up state for (re)connecting clients

## Phase 6: Harden [DONE]
- [x] Reconnect/backoff, heartbeat watchdog, withheld-topics warning
- [x] F1_AUTH_TOKEN support (accepts raw login-session cookie; unwrapped server-side)
- [x] Replay mode + session picker (live ↔ recordings) with reset broadcast
- [x] Command queue in live client (Safari tab-suspend drop fixed)
- [x] no-cache static serving; control-command logging
- [x] 35 unit tests + headless live smoke (20 checks) + picker e2e (11 checks)

## Phase 7: Polish [MOSTLY DONE]
- [x] README runbook (race-day ops, token flow, feed findings)
- [x] Session identity chip (LIVE/ENDED/REPLAY/NO FEED/SIM)
- [x] Next-session countdown in Eastern time (/api/next-session, jolpica calendar)
- [ ] Optional: Heimdall tile + Cloudflare tunnel route ← not started, optional
- [ ] Optional: clean up small recording stubs from today's container restarts

## Deployment [LIVE on NAS] ← PAUSED HERE
- [x] Running at http://192.168.0.9:8088 (host 8088 → container 8080)
- [x] Full telemetry verified with Jamison's F1 TV token (expires ~2026-07-11)
- [ ] ghcr package still PRIVATE → Watchtower auto-update inactive (needs Jamison's
      one-click visibility flip; local-build workaround in place meanwhile)
- [ ] Confirm Jamison's Safari works end-to-end (reload ⌘⌥R + Start) — race day check

Blockers: none. Next session: race day Sunday 2026-07-05, 10:00 AM EDT.
