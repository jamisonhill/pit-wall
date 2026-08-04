# Resume: Pit Wall (spoiler-safe Formula 1 archive)

**Last worked:** 2026-08-04
**State:** the pivot is complete and committed locally; **not yet deployed to the NAS**

## What this is now

The live telemetry dashboard turned into a **historical archive with a spoiler line**.
You declare how far through the season you have watched; the site renders F1 as it
stood at that moment. The gate is enforced in SQL (`server/archive/spoiler.js`), so a
result past your line is never selected, never serialised, never sent.

The old live dashboard is intact at `/race-room/`, reached through an explicit
confirmation. Its recorded-session replay is the genuinely useful part.

Read `README.md` first — it explains the gate, the pages, and the two derived circuit
statistics. `.planning/PROGRESS.md` has the phase-by-phase record.

## What is verified

- 59 tests pass (`npm test`), including `test/spoilerAudit.test.js`, which was
  mutation-tested: deleting one `revealed()` call fails it.
- Every page rendered and checked by eye in headless Chromium, desktop and iPhone width.
- All three line modes exercised: a specific round, completed-seasons-only, and
  fully-caught-up.
- Archive download, unzip, atomic swap and reopen all work from cold.

## Open items (in priority order)

1. **Deploy.** Nothing has been pushed to `main` since the pivot. On the NAS the
   compose file needs the new `./data` volume and `ARCHIVE_DIR` (both already in the
   repo's `docker-compose.yml`), then `docker-compose up -d --force-recreate`. First
   boot downloads ~15 MB from GitHub and unpacks to ~73 MB in `./data`.
2. **Node 24 is now required** (was 20) — `node:sqlite` needs ≥22.5. The Dockerfile is
   updated; anything running the old image will fail on import until it is rebuilt.
3. **ghcr package still private** → Watchtower can't pull. Either flip it to public
   (GitHub → repo → Packages → pit-wall → visibility) or use the local-build path below.
4. Optional: the tiny recording stubs in `/volume1/docker/pit-wall/recordings/` are
   still there (several <0.5 MB files; the 1.6 MB one is the real quali capture).

## How to deploy (until ghcr is public)

```bash
tar czf - --exclude node_modules --exclude .git --exclude recordings --exclude data \
  --exclude reference . | ssh nas-home "cat > /tmp/pit-wall-src.tar.gz"
ssh nas-home "echo '<sudo pw — see NAS-Home skill>' | sudo -S env PATH=/usr/local/bin:/usr/bin:/bin sh -c \
  'tar xzf /tmp/pit-wall-src.tar.gz -C /volume1/docker/pit-wall/src && \
   /usr/local/bin/docker build -q -t ghcr.io/jamisonhill/pit-wall:latest /volume1/docker/pit-wall/src && \
   /usr/local/bin/docker-compose -f /volume1/docker/pit-wall/docker-compose.yml up -d --force-recreate'"
```

Note the added `--exclude data` — the archive is 73 MB and downloads itself.

## Key decisions (why things are the way they are)

- **The gate is SQL, not UI.** Enforcing it in the browser would mean the data had
  already been sent. `parseAsOf` throws a 400 when `asOf` is missing, so a forgotten
  parameter fails loudly instead of quietly serving everything.
- **The line stores a choice, not a timestamp.** "Fully caught up" has to still mean
  "now" tomorrow, so `lib/line.js` resolves the mode to an `asOf` at request time.
- **F1DB's precomputed totals are banned.** `driver.total_race_wins` and friends are
  all-time figures; printing one announces a race you haven't seen. The audit test
  fails the build if a query file mentions any of them.
- **Titles count only from fully-revealed seasons.** A championship is a fact about a
  season's *final round*, so a season in progress contributes nothing however large
  the lead.
- **Overtaking index ranks finishers against each other**, not raw positions gained —
  otherwise Monaco's attrition makes it look like the best race on the calendar.
- **Poles come off the starting grid, gated on qualifying**, so a Saturday pole shows
  up before Sunday's result does.
- Host port 8088 (NAS 8080 is lamp-server). The NAS compose file with the real
  `F1_AUTH_TOKEN` is not in git.

## To resume

1. Read `README.md`, then this file. Memory file `pit-wall-deployment-state.md` has
   the NAS, token and feed specifics.
2. `npm start` → <http://localhost:8080>. First run downloads the archive.
3. `npm test` should be 59/59.
4. Highest-value next step is deploying, since none of this is on the NAS yet.
