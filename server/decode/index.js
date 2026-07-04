// ============================================================================
// DECODE  —  raw feed message → usable JSON object.
//
// Two jobs:
//   1) inflateRaw(): raw-DEFLATE decompress the *.z topics (CarData.z, Position.z).
//   2) mergeDelta(): fold SignalR incremental patches into per-topic running state.
// ============================================================================

import zlib from 'node:zlib';
import { COMPRESSED_TOPICS } from '../signalr/topics.js';

/**
 * Inflate a base64'd raw-DEFLATE payload (as sent for CarData.z / Position.z) into
 * a parsed JSON object. The F1 feed uses *raw* DEFLATE — no zlib/gzip header — so
 * inflateRawSync is required (inflateSync would throw).
 * @param {string} b64
 * @returns {any}
 */
export function inflateRaw(b64) {
  const compressed = Buffer.from(b64, 'base64');
  const text = zlib.inflateRawSync(compressed).toString('utf8');
  return JSON.parse(text);
}

/** True if a topic's payload must be inflated before use. */
export function isCompressed(topic) {
  return COMPRESSED_TOPICS.has(topic);
}

/**
 * Fold a SignalR delta patch into the running state for a topic, returning the
 * merged state (inputs are never mutated). The F1 feed sends one full snapshot
 * per topic at subscribe time, then partial patches with the same nesting — e.g.
 * TimingData patches look like { Lines: { "44": { LastLapTime: { Value: "1:23.4" } } } }
 * and must be merged into the snapshot, not replace it.
 *
 * Merge rules (mirrors what FastF1 and other clients do):
 *   • scalars / null → replace the old value outright
 *   • arrays in the patch → replace (the feed resends whole arrays when it uses them)
 *   • objects → recurse key-by-key
 *   • objects patching an ARRAY use numeric string keys ({ "2": {...} } patches
 *     element 2) — a feed quirk where a JSON array becomes a sparse object patch
 *   • "_kf" keys are feed keyframe markers, not data — skipped
 *
 * @param {any} state   current running state for the topic
 * @param {any} patch   incoming delta
 * @returns {any}       the new merged state
 */
export function mergeDelta(state, patch) {
  // Scalars, null, and whole arrays replace whatever was there before.
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;

  // The patch is a plain object patching an existing array: numeric keys are indices.
  if (Array.isArray(state)) {
    const merged = state.slice();
    for (const [key, value] of Object.entries(patch)) {
      if (key === '_kf') continue;
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0) {
        merged[index] = mergeDelta(merged[index], value);
      }
      // Non-numeric keys on an array patch have no defined meaning — ignore them.
    }
    return merged;
  }

  // Object onto object (or onto nothing): recurse per key.
  const base = (state !== null && typeof state === 'object') ? state : {};
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === '_kf') continue;
    merged[key] = mergeDelta(base[key], value);
  }
  return merged;
}
