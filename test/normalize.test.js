// Unit tests for the normalizer: raw topic snapshots + patches → typed events.
// Fixtures mirror the real feed shapes documented in FastF1. Run: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, resetNormalizer, keyframeEvents } from '../server/normalize/index.js';

const T = 1_000_000; // a fixed ingestTime for all fixtures

beforeEach(() => resetNormalizer());

function feed(topic, data) {
  return normalize({ topic, data, ingestTime: T });
}

// ---- DriverList ------------------------------------------------------------

const DRIVER_SNAPSHOT = {
  1:  { RacingNumber: '1',  Tla: 'VER', FullName: 'Max VERSTAPPEN', TeamName: 'Red Bull Racing', TeamColour: '3671C6', Line: 2 },
  4:  { RacingNumber: '4',  Tla: 'NOR', FullName: 'Lando NORRIS',   TeamName: 'McLaren',         TeamColour: 'FF8000', Line: 1 },
};

test('DriverList: snapshot emits the roster sorted by timing line', () => {
  const events = feed('DriverList', DRIVER_SNAPSHOT);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'driverList');
  assert.deepEqual(events[0].payload.map((d) => d.code), ['NOR', 'VER']);
  assert.deepEqual(events[0].payload[1],
    { num: 1, code: 'VER', name: 'Max VERSTAPPEN', team: 'Red Bull Racing', colour: '#3671C6' });
});

test('DriverList: a partial patch re-emits the full merged roster', () => {
  feed('DriverList', DRIVER_SNAPSHOT);
  const events = feed('DriverList', { 1: { Line: 1 }, 4: { Line: 2 } }); // they swap
  assert.deepEqual(events[0].payload.map((d) => d.code), ['VER', 'NOR']);
  assert.equal(events[0].payload[0].team, 'Red Bull Racing'); // survives the patch
});

// ---- TimingData --------------------------------------------------------------

const TIMING_SNAPSHOT = {
  Lines: {
    1: {
      Position: '1', GapToLeader: '', IntervalToPositionAhead: { Value: '' },
      LastLapTime: { Value: '1:23.456' }, BestLapTime: { Value: '1:22.111' },
      Sectors: [{ Value: '28.111', Segments: [{ Status: 2048 }, { Status: 2049 }] }],
      InPit: false, NumberOfPitStops: 0, NumberOfLaps: 12,
    },
    4: { Position: '2', GapToLeader: '+2.345', IntervalToPositionAhead: { Value: '+2.345' },
         LastLapTime: { Value: '1:23.900' }, InPit: false },
  },
};

test('TimingData: snapshot emits one timing event per driver', () => {
  const events = feed('TimingData', TIMING_SNAPSHOT);
  assert.equal(events.length, 2);
  const ver = events.find((e) => e.payload.num === 1).payload;
  assert.equal(ver.pos, 1);
  assert.equal(ver.lastLap, 83.456);            // "1:23.456" parsed to seconds
  assert.equal(ver.bestLap, 82.111);
  assert.deepEqual(ver.sectors[0].segments, [2048, 2049]);
});

test('TimingData: a patch emits only the patched driver, with merged state', () => {
  feed('TimingData', TIMING_SNAPSHOT);
  const events = feed('TimingData',
    { Lines: { 4: { LastLapTime: { Value: '1:21.000', PersonalFastest: true } } } });
  assert.equal(events.length, 1);
  const nor = events[0].payload;
  assert.equal(nor.num, 4);
  assert.equal(nor.lastLap, 81.0);
  assert.equal(nor.lastLapPB, true);
  assert.equal(nor.pos, 2);                     // carried over from the snapshot
  assert.equal(nor.gap, '+2.345');
});

// ---- CarData.z / Position.z (already inflated by the caller) -----------------

test('CarData.z: channels map to named telemetry fields', () => {
  const events = feed('CarData.z', {
    Entries: [{
      Utc: '2026-07-04T14:00:00Z',
      Cars: {
        1: { Channels: { 0: 11200, 2: 312, 3: 8, 4: 100, 5: 0, 45: 12 } },   // DRS 12 = open
        4: { Channels: { 0: 9500,  2: 88,  3: 2, 4: 0,   5: 100, 45: 8 } },  // DRS 8 = available
      },
    }],
  });
  assert.equal(events.length, 2);
  const ver = events.find((e) => e.payload.num === 1).payload;
  assert.deepEqual(ver, { num: 1, speed: 312, throttle: 100, brake: 0, gear: 8, rpm: 11200, drs: true, drsAvailable: true });
  const nor = events.find((e) => e.payload.num === 4).payload;
  assert.equal(nor.drs, false);
  assert.equal(nor.drsAvailable, true);
  assert.equal(nor.brake, 100);
});

test('Position.z: coordinates convert from 1/10 m to metres', () => {
  const events = feed('Position.z', {
    Position: [{
      Timestamp: '2026-07-04T14:00:00Z',
      Entries: {
        1: { Status: 'OnTrack', X: -12345, Y: 6789, Z: 100 },
        4: { Status: 'OffTrack', X: 0, Y: 0, Z: 0 },
      },
    }],
  });
  const ver = events.find((e) => e.payload.num === 1).payload;
  assert.equal(ver.x, -1234.5);
  assert.equal(ver.y, 678.9);
  assert.equal(ver.onTrack, true);
  assert.equal(events.find((e) => e.payload.num === 4).payload.onTrack, false);
});

// ---- RaceControlMessages -------------------------------------------------------

test('RaceControlMessages: emits each message exactly once across patches', () => {
  const first = feed('RaceControlMessages', {
    Messages: [{ Utc: '2026-07-04T14:00:00', Lap: 1, Category: 'Flag', Message: 'GREEN LIGHT', Flag: 'GREEN' }],
  });
  assert.equal(first.length, 1);
  assert.equal(first[0].payload.message, 'GREEN LIGHT');

  // Patches append via numeric keys onto the existing array.
  const second = feed('RaceControlMessages', {
    Messages: { 1: { Utc: '2026-07-04T14:05:00', Lap: 3, Category: 'Drs', Message: 'DRS ENABLED' } },
  });
  assert.equal(second.length, 1);
  assert.equal(second[0].payload.message, 'DRS ENABLED');

  // Re-sending nothing new emits nothing.
  assert.equal(feed('RaceControlMessages', { Messages: {} }).length, 0);
});

// ---- TimingAppData / WeatherData / session composite ----------------------------

test('TimingAppData: current stint maps to compound + age', () => {
  const events = feed('TimingAppData', {
    Lines: { 1: { Stints: [
      { Compound: 'SOFT', New: 'true', TotalLaps: 18 },
      { Compound: 'HARD', New: 'true', TotalLaps: 3 },
    ] } },
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload,
    { num: 1, compound: 'H', compoundName: 'HARD', age: 3, stint: 2, isNew: true });
});

test('WeatherData: string fields parse to numbers, rainfall to a boolean', () => {
  const events = feed('WeatherData', {
    AirTemp: '23.5', TrackTemp: '41.2', Humidity: '44', Pressure: '1013.2',
    Rainfall: '1', WindSpeed: '2.1', WindDirection: '120',
  });
  const w = events[0].payload;
  assert.equal(w.airTemp, 23.5);
  assert.equal(w.trackTemp, 41.2);
  assert.equal(w.rain, true);
  assert.equal(w.windDir, 120);
});

test('session: SessionInfo, TrackStatus and LapCount accumulate into one view', () => {
  feed('SessionInfo', { Meeting: { Name: 'British Grand Prix', Circuit: { ShortName: 'Silverstone' } }, Name: 'Race' });
  feed('TrackStatus', { Status: '4', Message: 'SCDeployed' });
  const events = feed('LapCount', { CurrentLap: 31, TotalLaps: 52 });
  assert.deepEqual(events[0].payload, {
    gp: 'British Grand Prix', circuit: 'Silverstone', session: 'Race', status: null,
    lap: 31, totalLaps: 52, flag: 'SC', clock: null,
  });
});

// ---- Keyframes -----------------------------------------------------------------

test('keyframeEvents re-emits full merged state, excluding raceControl', () => {
  feed('DriverList', DRIVER_SNAPSHOT);
  feed('TimingData', TIMING_SNAPSHOT);
  feed('TimingAppData', { Lines: { 1: { Stints: [{ Compound: 'SOFT', New: 'true', TotalLaps: 4 }] } } });
  feed('WeatherData', { AirTemp: '20', TrackTemp: '30', Rainfall: '0' });
  feed('SessionInfo', { Meeting: { Name: 'Test GP' }, Name: 'Race' });
  feed('RaceControlMessages', { Messages: [{ Utc: 'x', Category: 'Flag', Message: 'GREEN' }] });

  const T2 = T + 60_000;
  const kf = keyframeEvents(T2);
  const types = kf.map((e) => e.type);
  assert.ok(types.includes('driverList'));
  assert.ok(types.includes('session'));
  assert.ok(types.includes('weather'));
  assert.equal(types.filter((t) => t === 'timing').length, 2);   // both drivers
  assert.equal(types.filter((t) => t === 'tyres').length, 1);
  assert.ok(!types.includes('raceControl'));                     // append-only — never re-emitted
  assert.ok(kf.every((e) => e.ingestTime === T2));               // stamped fresh
  // Keyframe content matches merged state (spot check).
  const roster = kf.find((e) => e.type === 'driverList').payload;
  assert.deepEqual(roster.map((d) => d.code), ['NOR', 'VER']);
  assert.equal(kf.find((e) => e.type === 'session').payload.gp, 'Test GP');
});

test('keyframeEvents is empty before any state has arrived', () => {
  assert.deepEqual(keyframeEvents(T), []);
});

test('unknown topics are dropped, malformed payloads never throw', () => {
  assert.deepEqual(feed('TeamRadio', { Captures: [] }), []);
  assert.deepEqual(feed('CarData.z', { Entries: [{ Cars: null }] }), []);
  assert.deepEqual(feed('TimingData', { Lines: { 99: null } }), []);
  assert.deepEqual(feed('Heartbeat', { Utc: 'x' }), []);
});
