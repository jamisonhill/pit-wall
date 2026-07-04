// ============================================================================
// DECODE  —  raw feed message → usable JSON object.  ⚠️ Mostly a stub for Fable 5.
//
// Two jobs:
//   1) inflateRaw(): raw-DEFLATE decompress the *.z topics (CarData.z, Position.z).
//      This helper IS implemented — it's stable Node stdlib and worth getting right.
//   2) mergeDelta(): fold SignalR incremental patches into per-topic running state.
//      Stubbed — the delta shape is topic-specific; build it against the replay corpus.
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
 * Fold a SignalR delta patch into the running state for a topic.
 * TODO(Fable 5): implement per-topic merge (TimingData/DriverList are nested
 * partial patches keyed by driver number; CarData/Position are snapshot arrays).
 * Keep a `state` map per topic and return the merged current state.
 * @param {object} state   current running state for the topic (mutated/returned)
 * @param {any} patch      incoming delta
 * @returns {object}
 */
export function mergeDelta(state, patch) {
  // Placeholder shallow merge — good enough for flat snapshot topics, NOT for the
  // nested delta topics. Replace with real per-topic logic.
  if (Array.isArray(patch)) return patch;
  return { ...state, ...patch };
}
