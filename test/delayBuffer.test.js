// Unit tests for the delay engine — the one piece of core logic worth locking down.
// Uses an injected clock so there are no real timers and behaviour is deterministic.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DelayBuffer } from '../server/buffer/delayBuffer.js';

// A controllable clock.
function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('releases events live (offset 0) after start', () => {
  const clock = makeClock(1000);
  const released = [];
  const b = new DelayBuffer({ now: clock.now, onRelease: (e) => released.push(e), startOffsetSeconds: 0 });

  b.push({ id: 'a', ingestTime: 1000 });
  b.start();
  clock.advance(50); b.push({ id: 'b', ingestTime: 1050 });
  b.tick();

  // With offset 0, both events up to `now` should have been released.
  assert.deepEqual(released.map(e => e.id), ['a', 'b']);
});

test('holds events back by the offset', () => {
  const clock = makeClock(0);
  const released = [];
  const b = new DelayBuffer({ now: clock.now, onRelease: (e) => released.push(e), startOffsetSeconds: 10 });

  b.start();
  b.push({ id: 'x', ingestTime: 0 });
  b.tick();
  // Only 0s elapsed but offset is 10s → nothing released yet.
  assert.equal(released.length, 0);

  clock.advance(10_000); // 10s later
  b.push({ id: 'y', ingestTime: 10_000 });
  b.tick();
  // Now the 10s-old event 'x' is due; 'y' (just arrived) is still held.
  assert.deepEqual(released.map(e => e.id), ['x']);
});

test('pause freezes the head while ingest keeps filling the buffer', () => {
  const clock = makeClock(0);
  const released = [];
  const b = new DelayBuffer({ now: clock.now, onRelease: (e) => released.push(e), startOffsetSeconds: 0 });

  b.start();
  b.push({ id: '1', ingestTime: 0 });
  b.tick();
  assert.deepEqual(released.map(e => e.id), ['1']);

  b.pause();
  clock.advance(3000);
  b.push({ id: '2', ingestTime: 3000 });
  b.tick();
  // Paused → '2' is buffered but NOT released.
  assert.deepEqual(released.map(e => e.id), ['1']);
  assert.ok(b.bufferDepthSeconds() >= 3);

  b.resume();
  b.tick();
  // Resuming releases what accumulated.
  assert.deepEqual(released.map(e => e.id), ['1', '2']);
});

test('jumpLive snaps to the live edge and clears offset', () => {
  const clock = makeClock(0);
  const released = [];
  const b = new DelayBuffer({ now: clock.now, onRelease: (e) => released.push(e), startOffsetSeconds: 30 });
  b.start();
  b.push({ id: 'p', ingestTime: 0 });
  clock.advance(5000);
  b.push({ id: 'q', ingestTime: 5000 });
  b.tick(); // offset 30 → nothing due yet

  b.jumpLive();
  assert.equal(b.state().offsetSeconds, 0);
  assert.equal(b.behindLiveSeconds(), 0);
});

test('reset clears the stream and returns to standby, keeping the offset', () => {
  const clock = makeClock(0);
  const released = [];
  const b = new DelayBuffer({ now: clock.now, onRelease: (e) => released.push(e), startOffsetSeconds: 30 });
  b.push({ id: 'a', ingestTime: 0 });
  b.start();
  clock.advance(60_000); b.tick();

  b.reset();
  const s = b.state();
  assert.equal(s.started, false);
  assert.equal(s.paused, true);
  assert.equal(s.bufferDepthSeconds, 0);
  assert.equal(s.offsetSeconds, 30);          // the TV-sync preference survives

  // The buffer works normally on the new stream after a reset.
  const before = released.length;
  clock.advance(1000); b.push({ id: 'new', ingestTime: clock.now() });
  b.start(); b.setOffset(0); clock.advance(10); b.tick();
  assert.deepEqual(released.slice(before).map((e) => e.id), ['new']);
});

test('prunes events older than maxSeconds behind live', () => {
  const clock = makeClock(0);
  const b = new DelayBuffer({ now: clock.now, onRelease: () => {}, maxSeconds: 10, startOffsetSeconds: 0 });
  b.start();
  b.push({ id: 'old', ingestTime: 0 });
  b.tick();
  b.push({ id: 'new', ingestTime: 20_000 }); // 20s later → 'old' is >10s behind live
  // 'old' should be pruned from the ring.
  assert.equal(b.oldestTime(), 20_000);
});
