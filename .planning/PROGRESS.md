# Pit Wall — Progress

## Era 1: live telemetry dashboard [COMPLETE, now the Race Room]
All 7 milestones done and verified on the NAS: SignalR ingest (both endpoints),
DEFLATE decode, delta merge, normalization, delay engine, recorder, replay, live-wired
dashboard, session picker, next-session countdown. Validated against the real feed
during 2026 British GP qualifying with a working F1 TV token.

**Superseded, not deleted.** Jamison never watches races live — the whole product was
optimised for a use case that doesn't happen. The engine now lives at `/race-room/`
behind an explicit confirmation, where its recorded-session replay is finally the
right tool: watch Sunday's race on Tuesday, at real pace, without the result reaching
you first.

## Era 2: spoiler-safe archive [ALL 4 PHASES DONE]

### Phase 1: the spine [DONE]
- [x] F1DB archive downloader — GitHub release check, dependency-free ZIP reader,
      atomic swap onto a mounted volume, 12-hourly refresh
- [x] `node:sqlite` handle (read-only, prepared-statement cache); Docker → node:24
- [x] **`server/archive/spoiler.js`** — the session-dated gate every query composes in
- [x] `/api/archive`, `/api/seasons`, `/api/calendar`, `/api/standings`, `/api/season-context`
- [x] Web shell, hash router, the gate screen, the persistent spoiler-line bar
- [x] Championship view: both tables, points split, progression chart, title permutations

### Phase 2: weekends and people [DONE]
- [x] Race weekend page — sessions revealed independently, padlock where sealed,
      grid-to-finish slope chart, classification, pit stops, championship swing
- [x] Driver page — career recomputed at the line, titles counted safely, season arc,
      per-circuit record, career heat strip
- [x] **Teammate head-to-head**, classified-only, quali gated separately from race
- [x] Constructor page; driver and constructor index pages

### Phase 3: depth [DONE]
- [x] Circuit pages — GeoJSON track outlines (equirectangular projection), pole-to-win,
      overtaking index, DNF rate, lap record, every winner
- [x] Head-to-head tool — any two drivers, shared races only
- [x] Records almanac — every leaderboard recounted at the line

### Phase 4: close out [DONE]
- [x] **`test/spoilerAudit.test.js`** — source scan + data audit; mutation-tested
- [x] Race Room reattached behind its own door; "back to the archive" link added
- [x] README rewritten; F1DB (CC BY 4.0) and f1-circuits (MIT) attributed in the footer
- [x] `data` volume added to docker-compose
- [x] 59 tests pass

## Verified by eye (headless Chromium, screenshots)
Gate · Championship (desktop + iPhone) · Calendar · Race weekend · Sealed race ·
Driver · Circuit (Monaco, Interlagos) · Head to head · Records · Race Room door.
All three line modes exercised: round, completed-season, and fully-caught-up.

## Not done / next
- [ ] **Not yet deployed to the NAS** — nothing pushed to `main` since the pivot.
      Needs `docker-compose up -d` after pulling, and the new `./data` volume.
- [ ] ghcr package still private → Watchtower inactive; local-build path still applies
      (see RESUME.md)
- [ ] `F1_AUTH_TOKEN` only matters for the Race Room now, and only during a session
