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
- **…and then updated exactly once, because it pins the container to a digest.**
  Diagnosed 2026-08-05. Two pushes since (12:12:34Z, 12:38:20Z) and seven polls
  (12:15–12:45Z) produced nothing: no 403, no update, pit-wall not even named in the
  log, yet `Scanned=9` throughout. Portainer shows why — the container's image is

      ghcr.io/jamisonhill/pit-wall:latest@sha256:4ba2c2872e539d8ae2f9f27c29a469ce…

  `4ba2c287…` is the id Watchtower logged when it pulled at 12:10:30. On recreating
  the container it wrote the reference back **digest-pinned**, and a pinned reference
  has nothing to update — `:latest` in that string is decorative. Note the pin isn't
  a registry manifest digest either (the registry served `0f951c82…`, now
  `ddf34831…`), so it can never match what ghcr advertises.
- **Suspected shape of the bug, NOT yet confirmed:** a manual compose deploy creates
  the container tracking the bare tag → Watchtower checks it every cycle → updates it
  once → pins it → dormant until the next manual deploy. That would make auto-deploy
  one-shot per manual deploy. The history fits, but it has been observed only once.
- Race Room still works behind its door; its `F1_AUTH_TOKEN` expires ~weekly and only
  affects live telemetry, not the archive.

## Next action

**Blocked on being on the home network** — Jamison was off-network when this was
diagnosed, so none of the below has been run.

1. **Unpin the container.** `docker-compose up -d --force-recreate` on the pit-wall
   stack. This both deploys the current image (two commits ahead as of 12:38Z) and
   rewrites the reference back to the bare tag. Verify in Portainer → pit-wall →
   IMAGE: it should read `ghcr.io/jamisonhill/pit-wall:latest` with **no** `@sha256`.
2. **Then test whether the pin recurs.** Push a trivial commit and wait two Watchtower
   ticks. If it updates and then goes silent again, auto-deploy is one-shot and the
   Watchtower docs need reading for the option that governs this — don't guess a flag
   name, look it up.
3. `cognito-api` still 403s in every session — a separate package that is still
   private. Either flip it too, or mount the host's `/root/.docker/config.json` into
   Watchtower at `/config.json`, which fixes it without a visibility change.
4. **`F1_AUTH_TOKEN` has expired** — the container log shows
   `topics not granted {"missing":["CarData.z","Position.z","RcmSeries"]}`. Race Room
   car telemetry and the live track map only; the archive is unaffected. Refresh when
   a session weekend actually needs it.

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
