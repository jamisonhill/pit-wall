# Resume — Pit Wall (spoiler-safe Formula 1 archive)

**Paused:** 2026-08-05 · **Reason:** deploy fix blocked on being off the home network
**Phase/Task:** Phase 6 auto-deploy — container needs unpinning
**Tree:** clean · **Last commit:** 7e6d172 Found it: Watchtower pins the container to a digest

## State
- The archive itself is done, deployed, and working. 59 tests pass. Nothing about the
  app is outstanding — this phase is purely about the deploy pipeline.
- Auto-deploy **worked exactly once** (12:10:30Z) after the ghcr package went public,
  then went silent. Package visibility is separate from repo visibility.
- **Cause found:** Watchtower recreated the container with a digest-pinned image,
  `ghcr.io/jamisonhill/pit-wall:latest@sha256:4ba2c287…`. A pinned reference has
  nothing to update, so pit-wall vanished from seven polls while still in `Scanned=9`.
- The running container is therefore **two commits behind** (`64eab1d`); `7e6d172` is
  pushed and built but not deployed.
- `F1_AUTH_TOKEN` has expired — `CarData.z`/`Position.z`/`RcmSeries` not granted.
  Race Room telemetry only; the archive doesn't touch the feed.

## Next action
1. On the home network: `docker-compose up -d --force-recreate` on the pit-wall stack.
   Unpins the container *and* deploys the three pending commits in one go.
2. Verify in Portainer → pit-wall → IMAGE: must read a bare
   `ghcr.io/jamisonhill/pit-wall:latest` with **no** `@sha256`.
3. Push a trivial commit, wait two 300s ticks, and see whether Watchtower re-pins. If
   it does, auto-deploy is one-shot per manual deploy — read Watchtower's docs.

## Gotchas
- **Portainer's Recreate button won't fix the pin** — it reuses the container's
  existing (pinned) reference. The compose file is what holds the bare tag. The stack
  also shows as external/limited in Portainer, so the Stacks editor is unavailable.
- **Server, paths, and the deploy command are deliberately not in this public repo.**
  They live in the `NAS-Home` skill and the `pit-wall-deployment-state` memory.
- **Never build the source tarball with `--exclude data`** — bsdtar matches trailing
  path components and silently strips `web/data/` too, blanking the deployed site.
- **A `docker pull` on the server proves nothing about package visibility** — the root
  docker config has cached ghcr credentials. Use `gh api` or the Watchtower log.
- Portainer's Created column is local time (EDT); the log is UTC. That four-hour
  offset cost two wrong readings during this debug.
