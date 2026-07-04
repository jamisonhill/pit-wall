// CONTROL CHANNEL — map transport commands coming from the browser onto the delay
// buffer. Commands arrive as JSON over the same WebSocket the events go out on:
//   { cmd: 'start' | 'pause' | 'resume' | 'jumpLive' }
//   { cmd: 'setOffset', seconds: number }
//   { cmd: 'nudgeOffset', deltaSeconds: number }
//   { cmd: 'scrubTo', ingestTime: number }
// Unknown/invalid commands are ignored (never throw on browser input).

import { log } from '../logger.js';

export function handleControl(buffer, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.cmd !== 'string') return;

  switch (msg.cmd) {
    case 'start': buffer.start(); break;
    case 'pause': buffer.pause(); break;
    case 'resume': buffer.resume(); break;
    case 'jumpLive': buffer.jumpLive(); break;
    case 'setOffset':
      if (Number.isFinite(msg.seconds)) buffer.setOffset(msg.seconds);
      break;
    case 'nudgeOffset':
      if (Number.isFinite(msg.deltaSeconds)) buffer.nudgeOffset(msg.deltaSeconds);
      break;
    case 'scrubTo':
      if (Number.isFinite(msg.ingestTime)) buffer.scrubTo(msg.ingestTime);
      break;
    default:
      log.warn('Unknown control command', { cmd: msg.cmd });
  }
}
