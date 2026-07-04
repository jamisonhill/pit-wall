// REPLAY SOURCE — feed a recorded raw stream (from server/recorder) back through the
// real decode → normalize pipeline, at REPLAY_SPEED. This is how you develop against
// realistic data on a non-race-day, and how you'd offer a spoiler-safe "watch a past
// race later" mode. ⚠️ Depends on decode/normalize being implemented by Fable 5.

import fs from 'node:fs';
import readline from 'node:readline';
import { normalize } from '../normalize/index.js';
import { isCompressed, inflateRaw } from '../decode/index.js';
import { log } from '../logger.js';

export class ReplaySource {
  /**
   * @param {object} opts
   * @param {string} opts.file            path to an .ndjson recording
   * @param {number} opts.speed           playback speed multiplier
   * @param {(event:object)=>void} opts.emit
   */
  constructor({ file, speed, emit }) {
    this.file = file;
    this.speed = speed || 1;
    this.emit = emit;
    this.stopped = false;
  }

  async start() {
    if (!this.file || !fs.existsSync(this.file)) {
      log.error('Replay file not found', { file: this.file });
      return;
    }
    log.info('Replaying recorded stream', { file: this.file, speed: this.speed });
    const rl = readline.createInterface({ input: fs.createReadStream(this.file) });
    let firstT = null;
    const startWall = Date.now();

    for await (const line of rl) {
      if (this.stopped) break;
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (firstT === null) firstT = rec.t;

      // Pace playback to match the original inter-message timing, scaled by speed.
      const elapsedOriginal = (rec.t - firstT) / this.speed;
      const elapsedWall = Date.now() - startWall;
      const wait = elapsedOriginal - elapsedWall;
      if (wait > 0) await sleep(wait);

      try {
        const data = isCompressed(rec.topic) ? inflateRaw(rec.raw) : JSON.parse(rec.raw);
        for (const ev of normalize({ topic: rec.topic, data, ingestTime: Date.now() })) {
          this.emit(ev);
        }
      } catch (err) {
        // A single bad line must not stop replay.
        log.warn('Replay: skipped a bad record', { error: String(err) });
      }
    }
    log.info('Replay finished');
  }

  stop() { this.stopped = true; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
