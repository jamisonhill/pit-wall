// RAW STREAM RECORDER — append every inbound feed message to a timestamped file.
// Purpose (see PLAN.md §7): capture one real session once, then replay it any day to
// develop/test without waiting for a live race. Also enables spoiler-safe "watch later".
//
// Format: newline-delimited JSON, one record per line: { t, topic, raw }.
// This is the exact input the replay source (server/sources/replaySource.js) reads back.

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger.js';

export class Recorder {
  constructor({ dir, enabled }) {
    this.enabled = enabled;
    this.stream = null;
    if (!enabled) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Filename is created once at startup. Date.now is fine here (not in hot logic).
      const name = `raw-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
      this.filePath = path.join(dir, name);
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
      log.info('Recorder writing raw stream', { file: this.filePath });
    } catch (err) {
      // A recorder failure must never take down ingest — just disable it.
      log.error('Recorder failed to open file; continuing without recording', { error: String(err) });
      this.enabled = false;
    }
  }

  /** Record one raw inbound message. `raw` is the pre-decode text/string from the feed. */
  write(topic, raw) {
    if (!this.enabled || !this.stream) return;
    try {
      this.stream.write(JSON.stringify({ t: Date.now(), topic, raw }) + '\n');
    } catch (err) {
      log.error('Recorder write failed', { error: String(err) });
    }
  }

  close() {
    if (this.stream) this.stream.end();
  }
}
