// Control channel: browser JSON → buffer methods / source switching.
// Never throws on garbage; setSource only forwards valid kinds. Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleControl } from '../server/control/index.js';

function fakeBuffer() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    start: record('start'), pause: record('pause'), resume: record('resume'),
    jumpLive: record('jumpLive'), setOffset: record('setOffset'),
    nudgeOffset: record('nudgeOffset'), scrubTo: record('scrubTo'),
  };
}

test('transport commands map to buffer methods', () => {
  const b = fakeBuffer();
  handleControl(b, JSON.stringify({ cmd: 'start' }));
  handleControl(b, JSON.stringify({ cmd: 'setOffset', seconds: 45 }));
  handleControl(b, JSON.stringify({ cmd: 'scrubTo', ingestTime: 123 }));
  assert.deepEqual(b.calls, [['start'], ['setOffset', 45], ['scrubTo', 123]]);
});

test('garbage input never throws and never reaches the buffer', () => {
  const b = fakeBuffer();
  handleControl(b, 'not json');
  handleControl(b, JSON.stringify({ nope: true }));
  handleControl(b, JSON.stringify({ cmd: 'setOffset', seconds: 'NaN' }));
  assert.deepEqual(b.calls, []);
});

test('setSource forwards only valid kinds to the switch handler', () => {
  const b = fakeBuffer();
  const switches = [];
  const onSetSource = (kind, file) => switches.push([kind, file]);

  handleControl(b, JSON.stringify({ cmd: 'setSource', kind: 'replay', file: 'raw-x.ndjson' }), onSetSource);
  handleControl(b, JSON.stringify({ cmd: 'setSource', kind: 'live' }), onSetSource);
  handleControl(b, JSON.stringify({ cmd: 'setSource', kind: 'evil' }), onSetSource);      // rejected
  handleControl(b, JSON.stringify({ cmd: 'setSource', kind: 'replay', file: 42 }), onSetSource); // non-string file dropped

  assert.deepEqual(switches, [
    ['replay', 'raw-x.ndjson'],
    ['live', undefined],
    ['replay', undefined],
  ]);
});
