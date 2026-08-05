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

## Phase 5: shipped [DONE]
- [x] Deployed and verified in a real browser on both the LAN port and the public
      hostname — gate renders, zero console errors
- [x] **`web/data/` committed** — an unanchored `data/` in `.gitignore` had excluded the
      circuit map, so every built image rendered a blank page while local dev worked
- [x] Favicon: SVG + 32px PNG + full-bleed apple-touch-icon; `.png` added to the MIME map
- [x] Deploy trap documented: bsdtar's `--exclude data` also strips `web/data/`

## Not done / next
- [x] **Auto-deploy unblocked (2026-08-05)** — the ghcr package is now public. Package
      and repository visibility are separate settings, which is what hid this for weeks
- [x] **Chain confirmed once** — Watchtower's 12:10:30Z poll found the new image,
      recreated the container, `Updated=1`. `push → Actions → ghcr → Watchtower` works
- [ ] **Unpin the container** (blocked: off-network). Watchtower recreated pit-wall
      with a digest-pinned reference (`:latest@sha256:4ba2c287…`), which has nothing
      to update, so it has ignored two later pushes across seven polls.
      `docker-compose up -d --force-recreate` restores the bare tag and deploys current
- [ ] **Then find out whether the pin recurs.** If Watchtower re-pins after every
      update, auto-deploy is one-shot per manual deploy — read its docs rather than
      guessing at options
- [ ] `cognito-api` still 403s — it's a separate private package, fixable by mounting
      the host docker config into Watchtower rather than by another visibility change
- [ ] `F1_AUTH_TOKEN` only matters for the Race Room now, and only during a session
