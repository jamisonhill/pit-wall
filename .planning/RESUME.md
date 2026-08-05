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
- **Auto-deploy works, observed 2026-08-05.** The ghcr package went public at 12:09Z;
  Watchtower's 12:05Z poll still 403'd and its 12:10:30Z poll logged
  `Found new ghcr.io/jamisonhill/pit-wall:latest image` → stop → create →
  `Updated=1`. Package visibility is a *separate setting* from repository
  visibility, which is what hid this for weeks.
- **Caveat: it then went quiet.** A push at 12:12:34Z produced a new `latest`
  (`sha256:0f951c82…`, verified served anonymously) and four subsequent polls
  (12:15–12:30Z) didn't pick it up — no 403, no update, pit-wall not mentioned, but
  still `Scanned=9` so it hasn't left the label filter. Unexplained. If it recurs,
  restart `bug-reporting-watchtower` to clear its state before digging further.
- Race Room still works behind its door; its `F1_AUTH_TOKEN` expires ~weekly and only
  affects live telemetry, not the archive.

## Next action
1. **Work out why the second update didn't fire** (see the caveat above). Read the
   Watchtower log at the next 300s tick; if pit-wall is still unmentioned, restart
   the watcher and push a trivial commit to retest.
2. `cognito-api` still 403s in every session — a separate package that is still
   private. Either flip it too, or mount the host's `/root/.docker/config.json` into
   Watchtower at `/config.json`, which fixes it without a visibility change.

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
