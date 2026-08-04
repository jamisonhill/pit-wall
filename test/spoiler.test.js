// Tests for the spoiler line — the one guarantee this dashboard makes.
//
// Everything runs against a small purpose-built SQLite fixture rather than the real
// 73 MB archive, so the suite needs no download and the interesting cases (a race
// with no recorded start time, qualifying on the Saturday of a race still hidden)
// can be constructed exactly.
//
// Run: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openArchive, closeArchive, all } from '../server/archive/db.js';
import {
  parseAsOf, SpoilerError, revealed, revealedForTable, sessionEndedAt,
  latestRevealedRace, hiddenRoundCount, seasonCalendar, seasons,
} from '../server/archive/spoiler.js';

let fixturePath;

// A three-race season, shaped to exercise the fallbacks:
//   R1 — normal weekend: qualifying Saturday, race Sunday, both with times
//   R2 — a race with NO recorded start time (the historic case → treated as 23:59)
//   R3 — scheduled but never run (no result rows), i.e. the future
before(() => {
  fixturePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-')), 'fixture.db');
  const db = new DatabaseSync(fixturePath);
  db.exec(`
    CREATE TABLE season (year INTEGER PRIMARY KEY);
    CREATE TABLE country (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE circuit (id TEXT PRIMARY KEY, name TEXT, country_id TEXT);
    CREATE TABLE grand_prix (id TEXT PRIMARY KEY, short_name TEXT);
    CREATE TABLE race (
      id INTEGER PRIMARY KEY, year INTEGER, round INTEGER, date TEXT, time TEXT,
      grand_prix_id TEXT, official_name TEXT, circuit_id TEXT,
      qualifying_date TEXT, qualifying_time TEXT,
      sprint_race_date TEXT, sprint_race_time TEXT,
      sprint_qualifying_date TEXT, sprint_qualifying_time TEXT,
      free_practice_1_date TEXT, free_practice_1_time TEXT,
      free_practice_2_date TEXT, free_practice_2_time TEXT,
      free_practice_3_date TEXT, free_practice_3_time TEXT
    );
    CREATE TABLE race_result (race_id INTEGER, driver_id TEXT, position_number INTEGER);

    INSERT INTO season VALUES (2026);
    INSERT INTO country VALUES ('gb','United Kingdom');
    INSERT INTO circuit VALUES ('silverstone','Silverstone','gb');
    INSERT INTO grand_prix VALUES ('british','British');

    INSERT INTO race (id, year, round, date, time, grand_prix_id, official_name,
                      circuit_id, qualifying_date, qualifying_time)
    VALUES (1, 2026, 1, '2026-07-05', '14:00', 'british', 'Round One',
            'silverstone', '2026-07-04', '15:00');

    INSERT INTO race (id, year, round, date, time, grand_prix_id, official_name,
                      circuit_id, qualifying_date, qualifying_time)
    VALUES (2, 2026, 2, '2026-07-19', NULL, 'british', 'Round Two',
            'silverstone', NULL, NULL);

    INSERT INTO race (id, year, round, date, time, grand_prix_id, official_name,
                      circuit_id, qualifying_date, qualifying_time)
    VALUES (3, 2026, 3, '2026-08-23', '14:00', 'british', 'Round Three',
            'silverstone', '2026-08-22', '15:00');

    -- Rounds 1 and 2 have been run. Round 3 has not.
    INSERT INTO race_result VALUES (1, 'verstappen', 1), (2, 'norris', 1);
  `);
  db.close();
  openArchive(fixturePath, 'test-fixture');
});

after(() => {
  closeArchive();
  fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
});

// ---- parseAsOf --------------------------------------------------------------

test('parseAsOf refuses a missing spoiler line rather than defaulting to everything', () => {
  // Rule 1: a forgotten parameter must fail loudly. This is the assertion that
  // stops a future endpoint from quietly serving the whole archive.
  for (const bad of [undefined, null, '']) {
    assert.throws(() => parseAsOf(bad), SpoilerError);
  }
});

test('parseAsOf rejects an unparseable date', () => {
  assert.throws(() => parseAsOf('last tuesday'), SpoilerError);
  assert.throws(() => parseAsOf('not-a-date'), SpoilerError);
});

test('parseAsOf normalises to SQLite datetime format', () => {
  assert.equal(parseAsOf('2026-07-05T13:00:00Z'), '2026-07-05 13:00:00');
});

test('parseAsOf clamps a future line to now', () => {
  const parsed = parseAsOf('2999-01-01T00:00:00Z');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  assert.ok(parsed <= now, `${parsed} should not be past ${now}`);
});

test('a SpoilerError carries a 400 so handlers do not have to translate it', () => {
  try { parseAsOf(''); assert.fail('should have thrown'); }
  catch (err) { assert.equal(err.status, 400); }
});

// ---- The SQL gate -----------------------------------------------------------

test('revealed() builds a bound comparison, never an inlined value', () => {
  // If a cutoff were ever string-concatenated into SQL this would be the place it
  // showed up — and it would be an injection hole as well as a correctness one.
  assert.match(revealed('race'), /<= :asOf$/);
  assert.doesNotMatch(revealed('race'), /\d{4}-\d{2}-\d{2}/);
});

test('every results table has an explicit spoiler rule', () => {
  // Rule of thumb: a table with no rule is a table that leaks. revealedForTable
  // throws rather than falling back to something permissive.
  assert.doesNotThrow(() => revealedForTable('race_result'));
  assert.doesNotThrow(() => revealedForTable('qualifying_result'));
  assert.throws(() => revealedForTable('some_new_table_nobody_mapped'));
});

test('the grid is gated on qualifying, not on the race', () => {
  // The starting grid is public the moment qualifying ends. Gating it on the race
  // would hide something that is not a spoiler.
  assert.equal(revealedForTable('starting_grid_position'), revealedForTable('qualifying_result'));
  assert.notEqual(revealedForTable('starting_grid_position'), revealedForTable('race_result'));
});

test('sessionEndedAt rejects a session it has no dating rule for', () => {
  assert.throws(() => sessionEndedAt('teaBreak'));
});

// ---- Where the line sits ----------------------------------------------------

test('a race is hidden right up to its finish and revealed after', () => {
  // Round 1 starts 2026-07-05 14:00.
  assert.equal(latestRevealedRace(parseAsOf('2026-07-05T13:59:00Z'))?.round, undefined);
  assert.equal(latestRevealedRace(parseAsOf('2026-07-05T14:00:00Z'))?.round, 1);
  assert.equal(latestRevealedRace(parseAsOf('2026-07-06T00:00:00Z'))?.round, 1);
});

test('qualifying can be visible while the race it precedes is still sealed', () => {
  // This is the point of session granularity: Saturday night, the grid is known
  // and Sunday's result is not.
  const saturdayNight = parseAsOf('2026-07-04T20:00:00Z');
  const q = revealed('qualifying');
  const r = revealed('race');
  assert.notEqual(q, r);

  // Prove it against the fixture rather than trusting the strings.
  const quali = all(`SELECT round FROM race r WHERE ${q} ORDER BY round`, { asOf: saturdayNight });
  const races = all(`SELECT round FROM race r WHERE ${r} ORDER BY round`, { asOf: saturdayNight });
  assert.deepEqual(quali.map((x) => x.round), [1]);
  assert.deepEqual(races.map((x) => x.round), []);
});

test('a race with no recorded start time stays hidden for the whole of its day', () => {
  // Round 2 has a NULL time, so it is treated as finishing at 23:59 — midday on
  // race day must not reveal it.
  assert.equal(latestRevealedRace(parseAsOf('2026-07-19T12:00:00Z'))?.round, 1);
  assert.equal(latestRevealedRace(parseAsOf('2026-07-20T00:00:00Z'))?.round, 2);
});

test('qualifying with no date of its own falls back to the race, never earlier', () => {
  // Round 2 records no qualifying date. It must not become visible before the race
  // weekend it belongs to is behind the line.
  const midday = parseAsOf('2026-07-19T12:00:00Z');
  const visible = all(`SELECT round FROM race r WHERE ${revealed('qualifying')} ORDER BY round`,
    { asOf: midday });
  assert.deepEqual(visible.map((x) => x.round), [1]);
});

test('hiddenRoundCount counts run-but-unseen rounds, and ignores unrun ones', () => {
  // Line set just after round 1: round 2 is hidden, round 3 has not happened at all.
  assert.equal(hiddenRoundCount(parseAsOf('2026-07-06T00:00:00Z'), 2026), 1);
  // Caught up on both: nothing hidden, and the unrun round 3 is still not counted.
  assert.equal(hiddenRoundCount(parseAsOf('2026-07-20T00:00:00Z'), 2026), 0);
});

test('the calendar labels every round without revealing a result', () => {
  const cal = seasonCalendar(parseAsOf('2026-07-06T00:00:00Z'), 2026);
  assert.deepEqual(cal.map((r) => r.state), ['revealed', 'hidden', 'upcoming']);
  // Dates and names are fair game; nothing resembling a result is present.
  for (const round of cal) {
    assert.ok(round.grandPrix);
    assert.equal(Object.hasOwn(round, 'winner'), false);
    assert.equal(Object.hasOwn(round, 'points'), false);
  }
});

test('seasons are listed without a spoiler line — a year is not a result', () => {
  assert.deepEqual(seasons(), [2026]);
});
