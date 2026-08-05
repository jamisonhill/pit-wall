# Pit Wall — a spoiler-safe Formula 1 archive

A personal F1 reference dashboard built around one idea: **the spoiler line**.

You tell it how far through the season you have watched. It then shows you Formula 1
*as it stood at that moment* — the championship tables, every driver's career total,
the all-time records, everything. Nothing after your line is loaded. Not the
standings, not a lap record, not a career win count.

Set your line to the end of 2015 and Schumacher still leads the all-time win list,
because on that day he did.

> **Why.** This started life as a live telemetry dashboard for race day — buffer the
> feed, time-shift it to match the TV. That job never actually came up: races happen
> at 10am on Sundays and get watched on Tuesday. So the product turned around. The
> live engine is still here, behind a door, where its recorded-session replay is
> finally the right tool for the job.

---

## Run it

```bash
npm install
npm start
# open http://localhost:8080
npm test
```

First boot downloads the [F1DB](https://github.com/f1db/f1db) archive — every
Formula 1 session since 1950, about 15 MB compressed. The dashboard shows an
explicit "fetching the archive" state while that happens, then asks you to set your
spoiler line. Nothing is fetched until you do.

Needs **Node 22.5 or newer** for the built-in `node:sqlite` driver.

## The spoiler line

It is enforced in SQL, not in the browser. Every query composes one predicate into
its `WHERE` clause:

```sql
datetime(race.date || ' ' || COALESCE(race.time, '23:59')) <= :asOf
```

A result past your line is never selected, never serialised, never sent. You cannot
spoil yourself by opening the network tab, and a careless bit of front-end code
cannot leak a result it was never given.

Three rules hold it up (`server/archive/spoiler.js`):

1. **No `asOf`, no data.** An endpoint with no spoiler line answers `400` rather
   than defaulting to everything. A forgotten parameter has to fail loudly.
2. **All-time totals are recomputed, never read.** F1DB ships precomputed columns
   like `driver.total_race_wins`; every one is an *all-time* figure, so printing it
   would announce a win you haven't watched. `test/spoilerAudit.test.js` fails the
   build if a query so much as mentions one.
3. **The line only ever moves by hand.** New rounds show up as "3 newer rounds
   hidden", never as revealed data.

**Session granularity.** F1DB dates each session separately, so the line cuts
*between* sessions of the same weekend. Set it to Saturday evening and you can study
qualifying and the grid while Sunday's result stays sealed. The race page renders a
padlock where a session hasn't been reached.

Three ways to set it: pick the last Grand Prix you watched, take completed seasons
only, or unlock everything — which takes two deliberate clicks and says so.

## What's in it

| Page | What it answers |
|---|---|
| **Championship** | Both title tables at your line, each team's points split between its drivers, round-by-round progression, and title permutations worked out from the points still available |
| **Race weekend** | Qualifying, the grid-to-finish slope chart, full classification, pit stops, fastest lap, driver of the day, and how the afternoon moved the championship |
| **Driver** | Career totals recomputed at your line, season-by-season arc, per-circuit record, every race as a heat strip — and the teammate head-to-head |
| **Constructor** | Titles, wins, one-twos, engine partners, and everyone who has driven for them |
| **Circuit** | Track outline, pole-to-win conversion, the overtaking index, DNF rate, lap record, and every winner in the circuit's history |
| **Head to head** | Any two drivers, compared only over the races they both started |
| **Records** | Every all-time leaderboard, recounted at your line |
| **Race Room** | The original live-timing dashboard, behind an explicit confirmation |

Two numbers worth explaining, because no results table shows them:

- **Pole to win** — how often pole position actually converts here. It says what a
  Saturday lap is worth at a given track.
- **Overtaking index** — the average number of places a *finishing* car moves
  relative to the other finishers. The obvious version (average positions gained)
  ranks Monaco as the most exciting circuit in the sport, because half the field
  retires there and everyone who finishes inherits places they never overtook for.
  Ranking only the finishers against each other cancels that out. Under 2.0 is a
  procession; over 2.6 is chaos.

## Architecture

```
                         ┌─ F1DB SQLite archive ──┐
browser ──/api/*──►  spoiler gate  ──►  queries ──┘
   │                (server/archive/spoiler.js)
   └──/ws──►  signalr → decode → normalize → delay buffer   (Race Room only)
```

```
server/
  archive/
    download.js   fetch + unzip the newest F1DB release onto the data volume
    db.js         node:sqlite handle, read-only, prepared-statement cache
    spoiler.js    ★ the gate — every query composes it in
    queries/      standings · races · people · circuits · records
  api/index.js    the stats API; rejects any request with no spoiler line
  schedule.js     upcoming session calendar (jolpica) — not gated, a schedule isn't a result
  signalr/ buffer/ control/ recorder/ sources/ decode/ normalize/   the Race Room
web/
  index.html app.css app.js     shell + hash router
  lib/                          line · api · dom · icons · teams
  views/                        gate · standings · calendar · race · driver ·
                                constructor · circuit · h2h · records · raceroom
  components/                   chart (canvas) · track (GeoJSON → SVG)
  data/                         circuit outlines + the id bridge to F1DB
  race-room/                    the original live dashboard, unchanged
```

No framework, no build step — plain ES modules served straight off disk. Pages
scroll and collapse to one column on a phone.

## Configuration

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket |
| `ARCHIVE_DIR` | `./data` | Where the F1DB archive lives (mount this) |
| `ARCHIVE_AUTO_UPDATE` | `true` | Check GitHub for a newer F1DB release |
| `ARCHIVE_CHECK_HOURS` | `12` | How often to check |
| `SOURCE` | `sim` | Race Room feed: `sim` \| `signalr` \| `replay` |
| `DELAY_MAX_SECONDS` | `300` | Race Room buffer depth |
| `RECORD_RAW` / `RECORD_DIR` | `true` / `./recordings` | Record live sessions for replay |
| `F1_SIGNALR_MODE` | `auto` | `auto` \| `core` \| `classic` |
| `F1_AUTH_TOKEN` | — | F1 TV token, for car telemetry (see below) |
| `REPLAY_FILE` / `REPLAY_SPEED` | — / `1` | For `SOURCE=replay` |

## Tests

```bash
npm test
```

`test/spoiler.test.js` proves the gate is correct — including the two cases most
likely to leak: a race with no recorded start time, and qualifying visible on
Saturday while Sunday stays sealed.

`test/spoilerAudit.test.js` proves everything *behind* the gate actually uses it,
which is the failure mode that matters. A source scan checks that every query gates
every results table it touches and that no forbidden all-time column is read; a data
audit runs every query at a mid-season line and traces each returned row back to the
race it came from. It has been mutation-tested: deleting a single `revealed()` call
fails it. The data half needs the downloaded archive and skips loudly without it.

## Deploy to the NAS

```
GitHub Actions → ghcr.io/jamisonhill/pit-wall:latest → Watchtower → the NAS, port 8088
```

1. Push to `main`.
2. Copy `docker-compose.yml` to the project directory on the NAS and `docker-compose up -d`.
3. The archive downloads itself into `./data` on first boot and refreshes twice a
   day, so a new race weekend appears without a rebuild.

Both `./recordings` and `./data` are mounted volumes — a Watchtower update must not
trigger a 73 MB re-download.

## The Race Room

The original telemetry dashboard, reached through an explicit confirmation because
it is the one part of the application the spoiler line cannot filter: it shows a
session unfolding rather than answering a query.

**Replaying a recorded session is the good path** — it plays through the same
pipeline at original pace, so a race you missed on Sunday runs on Tuesday exactly as
it did live, and the result reaches you only when you get to it.

Live-feed notes, validated during 2026 British GP qualifying:

- The core endpoint (`signalrcore`) streams timing, tyres, weather, race control and
  session state **without a token**.
- `CarData.z` and `Position.z` — the telemetry gauges and the track map — are
  withheld unless `F1_AUTH_TOKEN` is set. Sign in at
  [account.formula1.com](https://account.formula1.com/#/en/login), copy the
  `login-session` cookie, paste the whole value into the compose file (the server
  unwraps it). **It expires after about a week**; the tell is the "topics not
  granted" warning returning and the track map going empty.
- The classic endpoint now 401s entirely.

## Credits

- Historical data: **[F1DB](https://github.com/f1db/f1db)**, licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Track outlines: **[bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)**
  (MIT), © 2019–2025 Tomislav Bacinger.
- Session schedules: the [jolpica](https://api.jolpi.ca/) Ergast-compatible API.

Personal and non-commercial; not associated with Formula 1. Don't publicly expose or
redistribute the raw live timing stream — the feed is reverse-engineered and its
terms are unclear.
