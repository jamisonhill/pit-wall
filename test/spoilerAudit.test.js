// ============================================================================
// THE SPOILER AUDIT
//
// spoiler.test.js proves the gate itself is correct. This proves everything
// *behind* it actually uses the gate — which is the failure mode that matters,
// because a single query that forgets `${revealed(...)}` is a leak, and it will
// look completely fine on screen right up until it ruins a race for you.
//
// Two independent checks, deliberately different in kind:
//
//   1. A SOURCE SCAN, which always runs. Every query file must gate every results
//      table it touches, and no file may read F1DB's precomputed all-time totals.
//      This catches a bad query the moment it is written, with no data needed.
//
//   2. A DATA AUDIT against the real archive. Every query is run at a line
//      mid-season and every row it returns is traced back to the race it came
//      from; any row belonging to a race past the line fails the test. Then the
//      same queries are run with the line at the present day, and the results must
//      differ — proving the gate is doing something rather than just being present.
//
// The data audit needs the ~73 MB F1DB archive, which is downloaded at runtime and
// not committed. Without it the audit skips loudly rather than passing quietly.
// ============================================================================

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openArchive, closeArchive, all } from '../server/archive/db.js';
import { parseAsOf } from '../server/archive/spoiler.js';
import { TABLE_SESSION } from '../server/archive/spoiler.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUERY_DIR = path.join(ROOT, 'server/archive/queries');

// ---------------------------------------------------------------------------
// 1. SOURCE SCAN — no archive required
// ---------------------------------------------------------------------------

/**
 * F1DB columns that hold ALL-TIME totals. Reading any of them prints a number that
 * includes races past your line: `driver.total_race_wins` on a career page would
 * announce a win you haven't watched, and `championship_won` would announce a
 * title before the season you are watching has finished.
 *
 * Every one of these has a gated equivalent, computed from per-session rows. If a
 * new query needs one of these, the answer is to compute it, not to allowlist it.
 */
const FORBIDDEN_COLUMNS = [
  'total_race_wins', 'total_race_starts', 'total_race_entries', 'total_podiums',
  'total_points', 'total_championship_points', 'total_championship_wins',
  'total_pole_positions', 'total_fastest_laps', 'total_grand_slams',
  'total_driver_of_the_day', 'total_sprint_race_wins', 'total_races_held',
  'total_1_and_2_finishes', 'total_podium_races', 'total_race_laps',
  'total_sprint_race_starts',
  'best_championship_position', 'best_race_result', 'best_starting_grid_position',
  'championship_won',
  // Season-level standings tables hold the FINAL classification of a season, which
  // is a spoiler for any season still in progress at the line. race_driver_standing
  // and race_constructor_standing (per-race) are the gated equivalents.
  'season_driver_standing', 'season_constructor_standing',
];

function queryFiles() {
  return fs.readdirSync(QUERY_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, source: fs.readFileSync(path.join(QUERY_DIR, name), 'utf8') }));
}

/** Strip line and block comments so prose about a column isn't mistaken for a read. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('source scan', () => {
  test('no query reads an all-time total from F1DB', () => {
    for (const { name, source } of queryFiles()) {
      const code = stripComments(source);
      for (const column of FORBIDDEN_COLUMNS) {
        assert.ok(
          !code.includes(column),
          `${name} references "${column}". That column is an ALL-TIME figure and leaks results ` +
          `past the spoiler line. Compute the value from per-session rows under ` +
          `\${revealed(...)} instead — see server/archive/spoiler.js, rule 2.`,
        );
      }
    }
  });

  test('every results table a query touches is gated in the same query', () => {
    // Any file that reads from a results table must also compose in the gate. This
    // is coarse — it checks per file, not per statement — but it is the check that
    // would have caught a whole query module written without `revealed`.
    const gatedTables = Object.keys(TABLE_SESSION);
    for (const { name, source } of queryFiles()) {
      const code = stripComments(source);
      const touched = gatedTables.filter((table) => new RegExp(`\\b${table}\\b`).test(code));
      if (!touched.length) continue;
      assert.match(
        code, /revealed\(/,
        `${name} reads ${touched.join(', ')} but never calls revealed(). Every query that ` +
        `touches a results table must compose the spoiler gate into its WHERE clause.`,
      );
    }
  });

  test('every API route that returns results demands a spoiler line', () => {
    const api = fs.readFileSync(path.join(ROOT, 'server/api/index.js'), 'utf8');
    // Routes that carry no results and are documented as needing no line.
    const OPEN_ROUTES = new Set(['/api/archive', '/api/seasons']);

    // Split the routes object into one chunk per route so each can be checked alone.
    const chunks = api.split(/'(\/api\/[a-z-]+)':/).slice(1);
    const seen = [];
    for (let i = 0; i < chunks.length; i += 2) {
      const route = chunks[i];
      const body = chunks[i + 1];
      seen.push(route);
      if (OPEN_ROUTES.has(route)) continue;
      assert.match(
        body, /parseAsOf\(/,
        `${route} does not call parseAsOf(). A route that returns results must reject a ` +
        `request with no spoiler line rather than defaulting to everything.`,
      );
    }
    assert.ok(seen.length >= 10, `expected to find the API routes, found ${seen.length}`);
  });
});

// ---------------------------------------------------------------------------
// 2. DATA AUDIT — needs the real archive
// ---------------------------------------------------------------------------

/** The downloaded archive, if this machine has one. */
function findArchive() {
  const dir = path.join(ROOT, 'data');
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'archive-version.json'), 'utf8'));
    if (meta?.dbPath && fs.existsSync(meta.dbPath)) return meta.dbPath;
  } catch { /* fall through to a directory scan */ }
  try {
    const db = fs.readdirSync(dir).find((n) => n.endsWith('.db'));
    if (db) return path.join(dir, db);
  } catch { /* no archive on this machine */ }
  return null;
}

const archivePath = findArchive();

describe('data audit', { skip: archivePath ? false : 'no F1DB archive on this machine — run `npm start` once to download it' }, () => {
  let line;           // the spoiler line under test
  let hiddenRaceIds;  // races that have been run but sit past it
  let hiddenRounds;   // their [year, round] pairs
  let canaries;       // distinctive strings that exist ONLY in those races
  let year;
  let round;

  before(() => {
    openArchive(archivePath, 'audit');

    // Put the line a few rounds back inside the most recent season that has races,
    // so there is definitely something on the other side of it to leak.
    const latest = all(`
      SELECT r.year, r.round, r.date, r.time
      FROM race r
      WHERE EXISTS (SELECT 1 FROM race_result rr WHERE rr.race_id = r.id)
      ORDER BY r.date DESC LIMIT 3
    `);
    assert.ok(latest.length >= 2, 'archive needs at least two completed races to audit');

    const target = latest.at(-1); // three races back
    year = target.year;
    round = target.round;
    line = parseAsOf(`${target.date}T${target.time ?? '12:00'}:00Z`);

    const hidden = all(`
      SELECT r.id, r.year, r.round
      FROM race r
      WHERE datetime(r.date || ' ' || COALESCE(r.time, '23:59')) > :asOf
        AND EXISTS (SELECT 1 FROM race_result rr WHERE rr.race_id = r.id)
    `, { asOf: line });
    hiddenRaceIds = new Set(hidden.map((r) => r.id));
    hiddenRounds = hidden.map((r) => [r.year, r.round]);
    assert.ok(hiddenRaceIds.size > 0, 'the chosen line must have hidden races behind it');

    /*
     * Canaries: strings that exist in the archive ONLY as part of a hidden race's
     * result. A winner's elapsed time ("1:22:27.097") and a fastest lap are precise
     * enough to be unique, which makes them a far better tripwire than a Grand Prix
     * name — "British GP" appears in every season, so finding it proves nothing.
     *
     * If any of these ever turns up in a response, something behind the gate is
     * serialising a result from a race the visitor has not watched.
     */
    canaries = all(`
      SELECT rr.time FROM race_result rr
      WHERE rr.race_id IN (${[...hiddenRaceIds].join(',')}) AND rr.position_number = 1
        AND rr.time IS NOT NULL
      UNION
      SELECT fl.time FROM fastest_lap fl
      WHERE fl.race_id IN (${[...hiddenRaceIds].join(',')}) AND fl.position_number = 1
        AND fl.time IS NOT NULL
    `).map((row) => row.time);
    assert.ok(canaries.length > 0, 'expected at least one distinctive value in the hidden races');
  });

  after(() => closeArchive());

  /** Walk a response and collect every raceId it mentions, however deeply nested. */
  function raceIdsIn(value, found = new Set()) {
    if (Array.isArray(value)) {
      for (const item of value) raceIdsIn(item, found);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if ((key === 'raceId' || key === 'race_id') && typeof child === 'number') found.add(child);
        raceIdsIn(child, found);
      }
    }
    return found;
  }

  /**
   * Every gated query, with arguments. Adding a query without adding it here is
   * the gap this test can't close on its own — the source scan above is what
   * covers that case.
   */
  async function everyQuery(asOf) {
    const standings = await import('../server/archive/queries/standings.js');
    const races = await import('../server/archive/queries/races.js');
    const people = await import('../server/archive/queries/people.js');
    const circuits = await import('../server/archive/queries/circuits.js');
    const records = await import('../server/archive/queries/records.js');
    const spoiler = await import('../server/archive/spoiler.js');

    // Pick subjects that actually appear in the archive.
    const driverIds = people.driverIndex(asOf, { limit: 3 }).map((d) => d.id);
    const constructorIds = people.constructorIndex(asOf, { limit: 2 }).map((c) => c.id);
    const circuitIds = circuits.circuitIndex(asOf).slice(0, 2).map((c) => c.id);

    return {
      calendar: spoiler.seasonCalendar(asOf, year),
      driverStandings: standings.driverStandings(asOf, year),
      constructorStandings: standings.constructorStandings(asOf, year),
      progression: standings.pointsProgression(asOf, year),
      raceAtLine: races.raceWeekend(asOf, year, round),
      raceAfterLine: races.raceWeekend(asOf, year, round + 1),
      driverIndex: people.driverIndex(asOf, { limit: 20 }),
      driverProfiles: driverIds.map((id) => people.driverProfile(asOf, id)),
      constructorProfiles: constructorIds.map((id) => people.constructorProfile(asOf, id)),
      circuitIndex: circuits.circuitIndex(asOf),
      circuitProfiles: circuitIds.map((id) => circuits.circuitProfile(asOf, id)),
      driverRecords: records.driverRecords(asOf),
      constructorRecords: records.constructorRecords(asOf),
      milestones: records.milestones(asOf),
      headToHead: driverIds.length >= 2
        ? records.headToHead(asOf, driverIds[0], driverIds[1]) : null,
    };
  }

  /** Every [year, round] pair an object in this payload identifies itself with. */
  function roundsIn(value, found = [], depth = 0) {
    if (depth > 12) return found;
    if (Array.isArray(value)) {
      for (const item of value) roundsIn(item, found, depth + 1);
    } else if (value && typeof value === 'object') {
      if (typeof value.year === 'number' && typeof value.round === 'number') {
        found.push([value.year, value.round]);
      }
      for (const child of Object.values(value)) roundsIn(child, found, depth + 1);
    }
    return found;
  }

  test('no query returns a row belonging to a race past the line', async () => {
    const responses = await everyQuery(line);
    const hiddenKeys = new Set(hiddenRounds.map(([y, r]) => `${y}|${r}`));

    // Two payloads legitimately identify a hidden round, and both carry only
    // calendar facts about it: the season calendar lists hidden rounds *as* hidden,
    // and a sealed race page names the race whose padlock it is showing. The
    // canary check below still applies to both, and the sessions-are-null test
    // covers the race page separately.
    const NAMES_HIDDEN_ROUNDS = new Set(['calendar', 'raceAfterLine']);

    for (const [name, payload] of Object.entries(responses)) {
      if (!NAMES_HIDDEN_ROUNDS.has(name)) {
        const leakedRounds = roundsIn(payload)
          .filter(([y, r]) => hiddenKeys.has(`${y}|${r}`))
          .map(([y, r]) => `${y} R${r}`);
        assert.deepEqual(leakedRounds, [],
          `${name} returned rows identified as ${leakedRounds.join(', ')}, which are past the line.`);
      }

      const leakedIds = [...raceIdsIn(payload)].filter((id) => hiddenRaceIds.has(id));
      assert.deepEqual(leakedIds, [],
        `${name} returned data for race id(s) ${leakedIds.join(', ')}, which are past the line.`);

      // The tripwire: a lap time or race time that only exists in a hidden race.
      const serialised = JSON.stringify(payload);
      for (const canary of canaries) {
        assert.ok(!serialised.includes(canary),
          `${name} contains "${canary}", a time set in a race past the spoiler line.`);
      }
    }
  });

  test('a race past the line reports every session sealed and no results', async () => {
    const { raceWeekend } = await import('../server/archive/queries/races.js');
    const after = raceWeekend(line, year, round + 1);
    assert.ok(after, 'the next round should still be listed — a calendar is not a spoiler');
    assert.equal(after.revealed.race, false);
    assert.equal(after.revealed.qualifying, false);
    // null, not [] — "not yet" and "nobody set a time" are different facts, and the
    // rows must not be serialised at all.
    assert.equal(after.results, null);
    assert.equal(after.qualifying, null);
    assert.equal(after.championship, null);
    assert.equal(after.fastestLap, null);
    assert.equal(after.driverOfTheDay, null);
  });

  test('the standings stop at the line, not at the newest race in the archive', async () => {
    const { driverStandings } = await import('../server/archive/queries/standings.js');
    const gated = driverStandings(line, year);
    assert.equal(gated.context.lastRace.round, round,
      'standings should be as they stood after the round the line sits on');
    assert.ok(gated.context.roundsRemaining > 0);

    // The points must be the R-at-the-line totals, so the leader's tally has to
    // match the standing row recorded after that exact race.
    const expected = all(`
      SELECT rds.points FROM race_driver_standing rds
      JOIN race r ON r.id = rds.race_id
      WHERE r.year = :year AND r.round = :round AND rds.position_display_order = 1
    `, { year, round })[0];
    assert.equal(gated.standings[0].points, expected.points);
  });

  test('moving the line changes the answers — the gate is doing work', async () => {
    // A gate that filtered nothing would pass every test above, so this is the
    // check that it is actually cutting something.
    const now = parseAsOf(new Date().toISOString());
    const { seasonCalendar } = await import('../server/archive/spoiler.js');
    const { driverStandings } = await import('../server/archive/queries/standings.js');
    const { driverRecords } = await import('../server/archive/queries/records.js');

    assert.notEqual(
      driverStandings(line, year).context.lastRace.round,
      driverStandings(now, year).context.lastRace.round,
      'standings at the line and at the present day are identical — is the gate applied?',
    );

    const revealedAt = (asOf) =>
      seasonCalendar(asOf, year).filter((r) => r.state === 'revealed').length;
    assert.ok(revealedAt(now) > revealedAt(line),
      'the present day should reveal more rounds than a line set mid-season');

    // And the almanac must move too — the leaderboard most likely to spoil.
    const winsAtLine = driverRecords(line).wins[0].value;
    const winsNow = driverRecords(now).wins[0].value;
    assert.ok(winsNow >= winsAtLine);
  });

  test('career totals grow when the line moves forward, never shrink', async () => {
    const { driverProfile, driverIndex } = await import('../server/archive/queries/people.js');
    const now = parseAsOf(new Date().toISOString());
    // Someone who has raced recently, so the extra rounds actually change something.
    const [driver] = driverIndex(now, { limit: 1 });
    const atLine = driverProfile(line, driver.id).career;
    const atNow = driverProfile(now, driver.id).career;

    assert.ok(atNow.entries > atLine.entries,
      `${driver.name} should have more entries at the present day than at the line`);
    for (const key of ['wins', 'podiums', 'points', 'poles']) {
      assert.ok(atNow[key] >= atLine[key], `${key} went down when the line moved forward`);
    }
  });
});
