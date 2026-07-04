// ============================================================================
// DELAY BUFFER — the core of the whole app.
//
// Two clocks (see PLAN.md §2):
//   • ingest clock  — real time; events arrive stamped with `ingestTime` (ms).
//   • playback head — the point in ingest-time we've released to the browser.
//
// In live play the head trails the live edge by `offsetMs`. Pausing FREEZES the
// head while ingest keeps filling the buffer (so you fall further behind live and
// can resume where you left off). This is exactly the TV-sync mechanism: nudge the
// offset until the dashboard matches your TV, pause when you step away.
//
// Fully implemented and unit-tested (test/delayBuffer.test.js). The clock is
// injectable so tests are deterministic and there are no real timers in logic.
// ============================================================================

export class DelayBuffer {
  /**
   * @param {object} opts
   * @param {(event:object)=>void} opts.onRelease   called for each released event, in order
   * @param {(state:object)=>void} [opts.onState]   called when transport state changes
   * @param {number} [opts.maxSeconds=300]          cap on buffer depth / max offset
   * @param {number} [opts.startOffsetSeconds=0]
   * @param {()=>number} [opts.now]                 clock injection (defaults to Date.now)
   */
  constructor({ onRelease, onState, maxSeconds = 300, startOffsetSeconds = 0, now = Date.now }) {
    this.onRelease = onRelease;
    this.onState = onState || (() => {});
    this.maxMs = maxSeconds * 1000;
    this.offsetMs = clamp(startOffsetSeconds * 1000, 0, this.maxMs);
    this.now = now;

    this.events = [];      // time-ordered ring of {ingestTime, ...}
    this.headTime = null;  // ingest-time released up to (null until first event)
    this.liveEdge = null;  // ingest-time of the newest event
    this.paused = true;    // starts paused/standby; call start() at lights-out
    this.started = false;
  }

  // ---- Ingest side --------------------------------------------------------

  /** Append a freshly-arrived event. Prunes anything older than maxMs behind live. */
  push(event) {
    if (typeof event.ingestTime !== 'number') event.ingestTime = this.now();
    // Keep the ring monotonic even if a source delivers slightly out of order.
    if (this.events.length && event.ingestTime < this.events[this.events.length - 1].ingestTime) {
      event.ingestTime = this.events[this.events.length - 1].ingestTime;
    }
    this.events.push(event);
    this.liveEdge = event.ingestTime;
    this._prune();
  }

  _prune() {
    // Drop an event only if it is BOTH older than maxMs behind live AND already
    // released (ingestTime <= head). This bounds the buffer to ~maxMs of history
    // while never discarding un-released backlog that a paused viewer still needs.
    // (Before start(), head is treated as +∞ so the pre-start buffer is still bounded.)
    const cutoff = this.liveEdge - this.maxMs;
    const effHead = this.headTime === null ? Infinity : this.headTime;
    let i = 0;
    while (
      i < this.events.length &&
      this.events[i].ingestTime < cutoff &&
      this.events[i].ingestTime <= effHead
    ) i++;
    if (i > 0) this.events.splice(0, i);
  }

  // ---- Playback side ------------------------------------------------------

  /**
   * Advance the playback head and release due events. Call on a fixed interval
   * (server ticks it ~every 50ms) or directly from tests with a supplied `now`.
   */
  tick() {
    if (this.liveEdge === null) return;           // nothing ingested yet
    if (!this.paused && this.started) {
      // Target = the ingest-time we should have shown by now, given the offset.
      // Upper-clamped to the live edge; NOT lower-clamped, so a large offset simply
      // means "nothing due yet" rather than forcing the oldest event out.
      const target = Math.min(this.liveEdge, this.now() - this.offsetMs);
      this._releaseUpTo(target);
    }
    this._emitState();
  }

  _releaseUpTo(target) {
    // headTime is the ingest-time released up to (inclusive). Start() seeds it just
    // below the oldest event so the first sweep includes the current snapshot.
    if (this.headTime === null) this.headTime = this.oldestTime() - 1;
    if (target <= this.headTime) return;          // nothing new is due (head never rewinds)
    for (const ev of this.events) {
      if (ev.ingestTime > this.headTime && ev.ingestTime <= target) {
        this.onRelease(ev);
      }
    }
    this.headTime = target;
  }

  // ---- Transport controls (driven by the browser control channel) ---------

  /** Begin playback at lights-out. Idempotent. Seeds the head just below the oldest
   *  buffered event so the first release sweep includes the current snapshot. */
  start() {
    this.started = true;
    this.paused = false;
    if (this.headTime === null) {
      const base = this.events.length ? this.oldestTime() : (this.liveEdge ?? this.now());
      this.headTime = base - 1;
    }
    this._emitState();
  }

  pause() { this.paused = true; this._emitState(); }
  resume() { if (this.started) this.paused = false; this._emitState(); }

  /**
   * Drop all buffered events and return to STANDBY (used when the data source is
   * switched, e.g. live → a recorded session). The configured offset is kept —
   * it's the user's TV-sync preference, not part of the stream.
   */
  reset() {
    this.events = [];
    this.headTime = null;
    this.liveEdge = null;
    this.paused = true;
    this.started = false;
    this._emitState();
  }

  /** Snap to the live edge and clear the delay. */
  jumpLive() {
    this.offsetMs = 0;
    this.headTime = this.liveEdge;
    this.paused = false;
    this.started = true;
    this._emitState();
  }

  /** Set the TV-sync offset in seconds (0..maxSeconds). Larger = further behind TV-safe. */
  setOffset(seconds) {
    this.offsetMs = clamp(seconds * 1000, 0, this.maxMs);
    this._emitState();
  }

  /** Nudge the offset by a delta in seconds (used by the ±1s / ±5s buttons). */
  nudgeOffset(deltaSeconds) {
    this.setOffset(this.offsetMs / 1000 + deltaSeconds);
  }

  /**
   * Scrub the head to an absolute ingest-time (from dragging the buffer bar).
   * Forward scrubs replay normally. Backward scrubs need the frontend to rebuild
   * state from a snapshot — the server emits a {type:'seek'} marker so the client
   * can reset. (Full snapshot-rebuild is a documented Fable 5 extension point.)
   */
  scrubTo(ingestTime) {
    const t = clamp(ingestTime, this.oldestTime(), this.liveEdge ?? 0);
    this.paused = true;
    if (this.liveEdge !== null) this.offsetMs = clamp(this.liveEdge - t, 0, this.maxMs);
    if (t < (this.headTime ?? t)) {
      this.onRelease({ type: 'seek', ingestTime: t, toTime: t });
    }
    this.headTime = t;
    this._emitState();
  }

  // ---- Introspection ------------------------------------------------------

  oldestTime() { return this.events.length ? this.events[0].ingestTime : (this.liveEdge ?? 0); }

  bufferDepthSeconds() {
    if (this.liveEdge === null) return 0;
    return (this.liveEdge - this.oldestTime()) / 1000;
  }

  behindLiveSeconds() {
    if (this.liveEdge === null || this.headTime === null) return 0;
    return Math.max(0, (this.liveEdge - this.headTime) / 1000);
  }

  state() {
    return {
      type: 'transport',
      started: this.started,
      paused: this.paused,
      offsetSeconds: this.offsetMs / 1000,
      maxSeconds: this.maxMs / 1000,
      bufferDepthSeconds: round1(this.bufferDepthSeconds()),
      behindLiveSeconds: round1(this.behindLiveSeconds()),
      liveEdge: this.liveEdge,
      headTime: this.headTime,
      oldestTime: this.events.length ? this.oldestTime() : null,
    };
  }

  _emitState() { this.onState(this.state()); }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
