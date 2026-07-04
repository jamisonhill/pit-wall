// CONTROL CHANNEL — map transport commands coming from the browser onto the delay
// buffer. Commands arrive as JSON over the same WebSocket the events go out on:
//   { cmd: 'start' | 'pause' | 'resume' | 'jumpLive' }
//   { cmd: 'setOffset', seconds: number }
//   { cmd: 'nudgeOffset', deltaSeconds: number }
//   { cmd: 'scrubTo', ingestTime: number }
//   { cmd: 'setSource', kind: 'live' | 'replay', file?: string }
// Unknown/invalid commands are ignored (never throw on browser input). Every
// accepted command is logged — "did the click reach the server?" must be
// answerable from docker logs alone.

import { log } from '../logger.js';

/**
 * @param {import('../buffer/delayBuffer.js').DelayBuffer} buffer
 * @param {string} raw                       the JSON text from the browser
 * @param {(kind:string, file?:string)=>void} [onSetSource]  source-switch handler
 */
export function handleControl(buffer, raw, onSetSource) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.cmd !== 'string') return;
  log.info('Control command received', { cmd: msg.cmd });

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
    case 'setSource':
      if (onSetSource && (msg.kind === 'live' || msg.kind === 'replay')) {
        onSetSource(msg.kind, typeof msg.file === 'string' ? msg.file : undefined);
      }
      break;
    default:
      log.warn('Unknown control command', { cmd: msg.cmd });
  }
}
