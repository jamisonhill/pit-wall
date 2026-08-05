# Pit Wall — Progress

## Era 1 — live telemetry dashboard [COMPLETE, superseded]
Built, deployed, validated against the real feed at 2026 British GP qualifying. Then
retired as the front door: Jamison never watches races live, so the whole product was
aimed at a use case that doesn't happen. The engine survives at `/race-room/` behind a
confirmation, where recorded-session replay is finally the right tool.

## Era 2 — spoiler-safe archive [COMPLETE]

- Phase 1 — the spine: F1DB downloader, `node:sqlite`, **the spoiler gate** [DONE]
- Phase 2 — race weekends, driver careers, teammate head-to-head, constructors [DONE]
- Phase 3 — circuits + track maps, head-to-head tool, records almanac [DONE]
- Phase 4 — spoiler audit test, Race Room door, README, attribution [DONE]
- Phase 5 — shipped: deployed, favicons, `web/data/` un-gitignored [DONE]

59 tests pass. Every page verified by eye in headless Chromium, desktop and phone,
across all three spoiler-line modes.

## Phase 6 — auto-deploy [IN PROGRESS] ← PAUSED HERE

- [x] ghcr **package** flipped to public (separate setting from repo visibility —
      that's what hid this for weeks)
- [x] Chain confirmed once: Watchtower's 12:10:30Z poll found the image, recreated the
      container, `Updated=1`
- [ ] **Unpin the container** — blocked, off-network. Watchtower recreated pit-wall
      with a digest-pinned reference (`:latest@sha256:4ba2c287…`), which has nothing to
      update, so it ignored two later pushes across seven polls.
      `docker-compose up -d --force-recreate` restores the bare tag and deploys current
- [ ] **Does the pin recur?** If Watchtower re-pins after every update, auto-deploy is
      one-shot per manual deploy. Read its docs; don't guess at flag names
- [ ] `cognito-api` still 403s — separate package, still private. Mounting the host
      docker config into Watchtower fixes it without another visibility change
- [ ] `F1_AUTH_TOKEN` expired — Race Room car telemetry only, archive unaffected
