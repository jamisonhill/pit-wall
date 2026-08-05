# Resume — Pit Wall (spoiler-safe Formula 1 archive)

**Paused:** 2026-08-05 · **Reason:** archive pivot deployed, verified, and liked
**Phase/Task:** Era 2 complete and live. No phase open.
**Tree:** clean · **Last commit:** ac2bed8 Correct the record: the package is private

## State
- Deployed and confirmed in a real browser on both the LAN port and the public
  hostname: gate renders, zero console errors, favicon in place.
- 59 tests pass. The spoiler audit is mutation-tested.
- `web/data/` (circuit map + GeoJSON) is now committed — an unanchored `data/` in
  `.gitignore` had kept it out, which blanked every deployed build.
- **Deploys are manual.** The ghcr *package* is private (the repo is public — separate
  setting), so Watchtower gets 403 and never updates. Pushing to `main` does nothing
  to the server.
- Race Room still works behind its door; its `F1_AUTH_TOKEN` expires ~weekly and only
  affects live telemetry, not the archive.

## Next action
1. Close the auto-deploy gap — either flip the ghcr package to public, or mount the
   host's docker config into the Watchtower container so it can authenticate. The
   second also fixes `cognito-api`, which fails the same way.
2. Until then, deploy with the documented manual path (see Gotchas for the trap).

## Gotchas
- **Server, paths, and the deploy command are deliberately not in this public repo.**
  They live in the `NAS-Home` skill and the `pit-wall-deployment-state` memory.
- **Never build the source tarball with `--exclude data`.** macOS bsdtar matches
  trailing path components, so it silently strips `web/data/` too — and even
  `--exclude ./data` does. Use an explicit include list of the paths to ship.
- **A `docker pull` on the server is not a package-visibility test** — the root docker
  config has cached ghcr credentials, so it succeeds against a private package.
  Use `gh api user/packages/container/pit-wall` or read the Watchtower log.
- The bind-mount dir for the archive must exist before `up -d` and be owned by uid
  1000; the container runs as `node` and the download fails with `EACCES` otherwise.
