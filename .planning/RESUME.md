# Resume — Pit Wall (spoiler-safe Formula 1 archive)

**Paused:** 2026-08-05 · **Reason:** archive pivot deployed, verified, and liked
**Phase/Task:** Era 2 complete and live. No phase open.
**Tree:** clean

## State
- Deployed and confirmed in a real browser on both the LAN port and the public
  hostname: gate renders, zero console errors, favicon in place.
- 59 tests pass. The spoiler audit is mutation-tested.
- `web/data/` (circuit map + GeoJSON) is now committed — an unanchored `data/` in
  `.gitignore` had kept it out, which blanked every deployed build.
- **Auto-deploy is unblocked as of 2026-08-05.** The ghcr package is now public
  (`gh api user/packages/container/pit-wall` → `"visibility":"public"`). Package
  visibility is a *separate setting* from repository visibility, which is what hid
  this for weeks. Not yet observed running end to end — see below.
- Race Room still works behind its door; its `F1_AUTH_TOKEN` expires ~weekly and only
  affects live telemetry, not the archive.

## Next action
1. **Confirm auto-deploy actually runs.** The blocker is gone but nothing has been
   pushed since the flip, so the `push → Actions → ghcr → Watchtower` chain is
   unproven. On the next commit, wait ~5 minutes (Watchtower polls every 300s) and
   check the site updated; if it didn't, read the Watchtower log rather than pulling
   on the server. Keep the manual path in reserve until it's seen working once.
2. `cognito-api` still 403s — a separate private package. Mounting the host's docker
   config into Watchtower fixes it without another visibility change.

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
