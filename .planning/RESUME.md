# Resume: Pit Wall (live F1 telemetry dashboard)

**Paused:** 2026-07-04, ~12:40 PM EDT (evening UTC), after British GP qualifying
**Reason:** Race-day ready — pausing until the British GP race, Sunday 10:00 AM EDT
**Phase:** all 7 build milestones done; deployed and verified on the NAS

## What is working (verified, not assumed)

- Container `pit-wall` on the NAS, dashboard at `http://192.168.0.9:8088`, `/healthz` green.
- Connected to the REAL F1 feed (core endpoint) with Jamison's F1 TV token — full
  telemetry incl. `CarData.z`/`Position.z` verified streaming during live qualifying.
- Transport left in **STANDBY** deliberately (he was mid-watching a *delayed* quali
  broadcast; starting would spoil it). Feed keeps buffering; recordings on disk.
- Session picker (live ↔ tonight's recordings), Data chip (LIVE/ENDED/REPLAY/NO FEED),
  next-session countdown in ET ("British Grand Prix — Race · Sun, Jul 5, 10:00 AM EDT").
- 35 unit tests pass; 20-check headless frontend smoke + 11-check picker e2e pass.

## Open items (in priority order)

1. **Race-day verification (Sun ~9:55 AM EDT):** Jamison reloads Safari (**⌘⌥R** — the
   no-cache header is deployed, so a plain reload also works now) and presses Start at
   lights-out. `docker logs pit-wall` now logs every control command — if he reports
   "nothing", check whether `{"cmd":"start"}` arrived. His last session ended before he
   confirmed a working Start in his browser; the two root causes (Safari command drop,
   buffer pruning) are fixed and verified headlessly, but not yet confirmed in HIS Safari.
2. **ghcr package visibility (Jamison, one click):** GitHub → pit-wall repo → Packages →
   package settings → change visibility to **public**. Until then Watchtower can't pull;
   deploys use the local-build path (next item).
3. **F1_AUTH_TOKEN expires ~2026-07-11** (grabbed 2026-07-04). Refresh: sign in at
   account.formula1.com → DevTools → Application → Cookies → formula1.com → copy
   `login-session` value into `F1_AUTH_TOKEN` in `/volume1/docker/pit-wall/docker-compose.yml`
   (server unwraps the cookie blob) → `docker-compose up -d --force-recreate`.
   Expiry tell: "topics not granted" warning naming the `.z` channels; track map empty.
4. Optional polish: Heimdall tile + Cloudflare tunnel; delete the tiny recording stubs in
   `/volume1/docker/pit-wall/recordings/` (several <0.5 MB files from container restarts;
   the 1.6 MB one is the real quali capture).

## How to deploy (until ghcr is public)

```bash
tar czf - --exclude node_modules --exclude .git --exclude recordings --exclude reference . \
  | ssh nas-home "cat > /tmp/pit-wall-src.tar.gz"
ssh nas-home "echo '<sudo pw — see NAS-Home skill>' | sudo -S env PATH=/usr/local/bin:/usr/bin:/bin sh -c \
  'tar xzf /tmp/pit-wall-src.tar.gz -C /volume1/docker/pit-wall/src && \
   /usr/local/bin/docker build -q -t ghcr.io/jamisonhill/pit-wall:latest /volume1/docker/pit-wall/src && \
   /usr/local/bin/docker-compose -f /volume1/docker/pit-wall/docker-compose.yml up -d --force-recreate'"
```
(Local dev: allowlisted command shape is `PORT=8099 RECORD_RAW=false node …`.)

## Key decisions made (why things are the way they are)

- Host port **8088** (NAS 8080 taken by lamp-server).
- **Keyframes** (server re-ingests merged state every 45s) rather than exempting state
  events from buffer pruning — also gives backward-scrub a rebuild point.
- Token accepted as the raw `login-session` cookie (server unwraps to subscriptionToken).
- Classic SignalR endpoint 401s now; adapter default mode `auto` still tries both.
- The NAS compose file (with the real token) is NOT in git — repo copy has it commented.
- Recording pauses while in replay mode (recorder is fed by the signalr source only);
  recordings are per-container-run, so a restart starts a new file.

## To resume

1. Read this file + `.planning/PROGRESS.md`; memory file
   `pit-wall-deployment-state.md` has the NAS/token/feed specifics.
2. `curl http://192.168.0.9:8088/healthz` — expect feedConnected true, source signalr.
3. Race day: nothing to deploy; it's ready. Just walk Jamison through reload + Start,
   and watch `docker logs pit-wall` for the control commands if anything looks off.
