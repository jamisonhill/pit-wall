// Unit tests for the decode layer: raw-DEFLATE inflation and the SignalR
// delta-merge — the two places a feed quirk would silently corrupt state.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { inflateRaw, isCompressed, mergeDelta } from '../server/decode/index.js';

// Build a fixture exactly the way the feed does: JSON → raw DEFLATE → base64.
function compress(obj) {
  return zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
}

test('inflateRaw round-trips a raw-DEFLATE base64 payload', () => {
  const payload = { Entries: [{ Cars: { 1: { Channels: { 2: 312 } } } }] };
  assert.deepEqual(inflateRaw(compress(payload)), payload);
});

test('only the .z topics are marked compressed', () => {
  assert.equal(isCompressed('CarData.z'), true);
  assert.equal(isCompressed('Position.z'), true);
  assert.equal(isCompressed('TimingData'), false);
});

test('mergeDelta: scalars and nulls replace', () => {
  assert.equal(mergeDelta('old', 'new'), 'new');
  assert.equal(mergeDelta({ a: 1 }, null), null);
  assert.equal(mergeDelta(5, 7), 7);
});

test('mergeDelta: nested objects merge key-by-key', () => {
  const state = { Lines: { 44: { Position: '3', LastLapTime: { Value: '1:23.456' } } } };
  const patch = { Lines: { 44: { LastLapTime: { Value: '1:22.900', PersonalFastest: true } } } };
  const merged = mergeDelta(state, patch);
  // Patched fields update, untouched siblings survive.
  assert.equal(merged.Lines[44].LastLapTime.Value, '1:22.900');
  assert.equal(merged.Lines[44].LastLapTime.PersonalFastest, true);
  assert.equal(merged.Lines[44].Position, '3');
  // And the original state was not mutated.
  assert.equal(state.Lines[44].LastLapTime.Value, '1:23.456');
});

test('mergeDelta: arrays in a patch replace outright', () => {
  const merged = mergeDelta({ Sectors: [{ Value: '30.1' }, { Value: '28.2' }] }, { Sectors: [{ Value: '29.9' }] });
  assert.deepEqual(merged.Sectors, [{ Value: '29.9' }]);
});

test('mergeDelta: numeric-key objects patch array elements in place', () => {
  const state = { Stints: [{ Compound: 'SOFT', TotalLaps: 5 }] };
  // The feed patches arrays as sparse objects: index → partial element.
  const merged = mergeDelta(state, { Stints: { 0: { TotalLaps: 6 }, 1: { Compound: 'HARD', TotalLaps: 1 } } });
  assert.equal(merged.Stints.length, 2);
  assert.deepEqual(merged.Stints[0], { Compound: 'SOFT', TotalLaps: 6 });
  assert.deepEqual(merged.Stints[1], { Compound: 'HARD', TotalLaps: 1 });
});

test('mergeDelta: _kf keyframe markers are not data', () => {
  const merged = mergeDelta({ a: 1 }, { _kf: true, b: 2 });
  assert.deepEqual(merged, { a: 1, b: 2 });
});

test('mergeDelta: merging onto nothing builds fresh state', () => {
  assert.deepEqual(mergeDelta(undefined, { a: { b: 1 } }), { a: { b: 1 } });
});
