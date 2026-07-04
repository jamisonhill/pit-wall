// ============================================================================
// NORMALIZE  —  raw F1 topics → stable internal event schema.
//
// The frontend must NEVER see a SignalR quirk. Every raw topic is folded into a
// per-topic running state (the feed sends one full snapshot then partial patches
// — see decode/mergeDelta) and re-emitted as typed events:
//
//   { type, ingestTime, sessionTime, payload }
//
//   type          payload
//   ───────────   ───────────────────────────────────────────────────────────────
//   driverList    [{ num, code, name, team, colour }]          (from DriverList)
//   session       { gp, circuit, session, status, lap, totalLaps, flag, clock }
//   carData       { num, speed, throttle, brake, gear, rpm, drs, drsAvailable }
//   position      { num, x, y, onTrack }                       (metres)
//   timing        { num, pos, gap, interval, lastLap, bestLap, sectors[], … }
//   tyres         { num, compound, compoundName, age, stint }
//   weather       { airTemp, trackTemp, wind, windDir, humidity, pressure, rain }
//   raceControl   { utc, lap, category, message, flag }
//
// State lives at module level: exactly one source (signalr | replay | sim) feeds
// this process at a time. resetNormalizer() clears it for tests and replay restarts.
// ============================================================================

import { mergeDelta } from '../decode/index.js';

// ---- Running state ----------------------------------------------------------

function freshState() {
  return {
    topics: {},        // topic name → merged running state
    rcEmitted: 0,      // how many RaceControlMessages we've already emitted
    session: {         // the composite view emitted as a `session` event
      gp: null, circuit: null, session: null, status: null,
      lap: null, totalLaps: null, flag: null, clock: null,
    },
  };
}

let state = freshState();

/** Clear all running state (tests, or restarting a replay). */
export function resetNormalizer() {
  state = freshState();
}

// ---- Small parsing helpers ---------------------------------------------------

/** "1:23.456" or "58.123" → seconds (number), else null. Feed times are strings. */
function parseLapTime(value) {
  if (typeof value !== 'string' || value === '') return null;
  const parts = value.split(':');
  let seconds = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    seconds = seconds * 60 + n;
  }
  return seconds;
}

/** Feed numbers often arrive as strings ("23.5"); parse defensively. */
function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The feed patches arrays as numeric-keyed objects; read either shape as a list. */
function toList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter((k) => k !== '_kf')
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => value[k]);
  }
  return [];
}

/** Driver-number keys of a Lines/Entries-style object (skipping feed markers). */
function driverKeys(obj) {
  return obj && typeof obj === 'object' ? Object.keys(obj).filter((k) => k !== '_kf') : [];
}

// ---- Topic-specific mappers ---------------------------------------------------

// CarData.z channel numbers → meaning (verified against FastF1's decoder).
const CH_RPM = '0', CH_SPEED = '2', CH_GEAR = '3', CH_THROTTLE = '4', CH_BRAKE = '5', CH_DRS = '45';

/** DRS channel codes: 0/1 closed, 8 eligible/available, 10/12/14 open. */
function drsFromCode(code) {
  const n = toNum(code) ?? 0;
  return { open: n >= 10, available: n >= 8 };
}

function mapCarData(data, ingestTime) {
  // Shape: { Entries: [{ Utc, Cars: { "44": { Channels: {...} }, … } }, …] }
  const events = [];
  for (const entry of toList(data?.Entries)) {
    for (const num of driverKeys(entry?.Cars)) {
      const ch = entry.Cars[num]?.Channels;
      if (!ch) continue;
      const drs = drsFromCode(ch[CH_DRS]);
      events.push({
        type: 'carData', ingestTime, sessionTime: entry.Utc ?? null,
        payload: {
          num: Number(num),
          speed: toNum(ch[CH_SPEED]) ?? 0,
          throttle: toNum(ch[CH_THROTTLE]) ?? 0,
          // Brake arrives as 0/100 (sometimes bool); normalize to 0–100.
          brake: ch[CH_BRAKE] === true ? 100 : (toNum(ch[CH_BRAKE]) ?? 0),
          gear: toNum(ch[CH_GEAR]) ?? 0,
          rpm: toNum(ch[CH_RPM]) ?? 0,
          drs: drs.open,
          drsAvailable: drs.available,
        },
      });
    }
  }
  return events;
}

function mapPosition(data, ingestTime) {
  // Shape: { Position: [{ Timestamp, Entries: { "44": { Status, X, Y, Z } } }, …] }
  // X/Y/Z are in 1/10 metre; emit metres so the frontend can scale bounds naturally.
  const events = [];
  for (const frame of toList(data?.Position)) {
    for (const num of driverKeys(frame?.Entries)) {
      const p = frame.Entries[num];
      const x = toNum(p?.X), y = toNum(p?.Y);
      if (x === null || y === null) continue;
      events.push({
        type: 'position', ingestTime, sessionTime: frame.Timestamp ?? null,
        payload: { num: Number(num), x: x / 10, y: y / 10, onTrack: p.Status !== 'OffTrack' },
      });
    }
  }
  return events;
}

function mapTimingLine(num, line, ingestTime) {
  const sectors = toList(line.Sectors).map((s) => ({
    time: parseLapTime(s?.Value),
    pb: Boolean(s?.PersonalFastest),
    ob: Boolean(s?.OverallFastest),
    segments: toList(s?.Segments).map((seg) => toNum(seg?.Status) ?? 0),
  }));
  return {
    type: 'timing', ingestTime, sessionTime: null,
    payload: {
      num: Number(num),
      pos: toNum(line.Position),
      // Gaps stay strings on purpose: the feed mixes "+12.345", "1 L", "LAP 12".
      gap: line.GapToLeader ?? null,
      interval: line.IntervalToPositionAhead?.Value ?? null,
      lastLap: parseLapTime(line.LastLapTime?.Value),
      lastLapPB: Boolean(line.LastLapTime?.PersonalFastest),
      lastLapOB: Boolean(line.LastLapTime?.OverallFastest),
      bestLap: parseLapTime(line.BestLapTime?.Value),
      sectors,
      inPit: Boolean(line.InPit),
      pitOut: Boolean(line.PitOut),
      retired: Boolean(line.Retired),
      stopped: Boolean(line.Stopped),
      stops: toNum(line.NumberOfPitStops) ?? 0,
      laps: toNum(line.NumberOfLaps),
    },
  };
}

const COMPOUND_CODE = {
  SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W',
};

function mapTyres(num, line, ingestTime) {
  const stints = toList(line?.Stints);
  if (!stints.length) return null;
  const current = stints[stints.length - 1];
  if (!current || !current.Compound) return null;
  return {
    type: 'tyres', ingestTime, sessionTime: null,
    payload: {
      num: Number(num),
      compound: COMPOUND_CODE[current.Compound] ?? '?',
      compoundName: current.Compound,
      age: toNum(current.TotalLaps) ?? 0,   // laps on this set (includes prior use)
      stint: stints.length,
      isNew: current.New === 'true' || current.New === true,
    },
  };
}

// TrackStatus codes → the flag the header shows.
const TRACK_FLAG = { 1: 'GREEN', 2: 'YELLOW', 4: 'SC', 5: 'RED', 6: 'VSC', 7: 'VSC' };

// ---- The entry point -----------------------------------------------------------

/**
 * Fold one raw topic message into running state and return zero or more
 * normalized events for the buffer.
 * @param {{topic:string, data:any, ingestTime:number}} msg
 * @returns {Array<{type:string, ingestTime:number, sessionTime:any, payload:any}>}
 */
export function normalize(msg) {
  const { topic, data, ingestTime } = msg;
  if (data === null || data === undefined) return [];

  switch (topic) {
    // -- Compressed telemetry: stateless per-sample streams, no delta merging --
    case 'CarData.z':
      return mapCarData(data, ingestTime);
    case 'Position.z':
      return mapPosition(data, ingestTime);

    // -- Per-driver delta topics: merge, then emit only the drivers patched --
    case 'TimingData': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      const lines = state.topics[topic]?.Lines ?? {};
      return driverKeys(data?.Lines ?? {})
        .filter((num) => lines[num])
        .map((num) => mapTimingLine(num, lines[num], ingestTime));
    }

    case 'TimingAppData': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      const lines = state.topics[topic]?.Lines ?? {};
      return driverKeys(data?.Lines ?? {})
        .map((num) => (lines[num] ? mapTyres(num, lines[num], ingestTime) : null))
        .filter(Boolean);
    }

    case 'DriverList': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      const merged = state.topics[topic] ?? {};
      const roster = driverKeys(merged)
        .map((num) => merged[num])
        .filter((d) => d && d.Tla)
        .sort((a, b) => (toNum(a.Line) ?? 99) - (toNum(b.Line) ?? 99))
        .map((d) => ({
          num: toNum(d.RacingNumber),
          code: d.Tla,
          name: d.FullName ?? d.BroadcastName ?? d.Tla,
          team: d.TeamName ?? '—',
          colour: d.TeamColour ? `#${d.TeamColour}` : '#888888',
        }));
      if (!roster.length) return [];
      // Re-emit the whole roster on any change — it's tiny and keeps clients simple.
      return [{ type: 'driverList', ingestTime, sessionTime: null, payload: roster }];
    }

    // -- Append-only feed: emit only messages we haven't emitted before --
    case 'RaceControlMessages': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      const messages = toList(state.topics[topic]?.Messages);
      const fresh = messages.slice(state.rcEmitted);
      state.rcEmitted = messages.length;
      return fresh.filter(Boolean).map((m) => ({
        type: 'raceControl', ingestTime, sessionTime: m.Utc ?? null,
        payload: {
          utc: m.Utc ?? null,
          lap: toNum(m.Lap),
          category: m.Category ?? 'Other',   // Flag | SafetyCar | Drs | CarEvent | Other
          message: m.Message ?? '',
          flag: m.Flag ?? null,              // e.g. YELLOW, CLEAR, CHEQUERED
        },
      }));
    }

    // -- Flat topics that feed the composite `session` event --
    case 'SessionInfo': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      const info = state.topics[topic] ?? {};
      state.session.gp = info.Meeting?.Name ?? state.session.gp;
      state.session.circuit = info.Meeting?.Circuit?.ShortName ?? state.session.circuit;
      state.session.session = info.Name ?? state.session.session;
      return [sessionEvent(ingestTime)];
    }
    case 'SessionStatus': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      state.session.status = state.topics[topic]?.Status ?? state.session.status;
      return [sessionEvent(ingestTime)];
    }
    case 'LapCount': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      const lc = state.topics[topic] ?? {};
      state.session.lap = toNum(lc.CurrentLap) ?? state.session.lap;
      state.session.totalLaps = toNum(lc.TotalLaps) ?? state.session.totalLaps;
      return [sessionEvent(ingestTime)];
    }
    case 'TrackStatus': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      const code = toNum(state.topics[topic]?.Status);
      state.session.flag = TRACK_FLAG[code] ?? state.session.flag;
      return [sessionEvent(ingestTime)];
    }
    case 'ExtrapolatedClock': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      state.session.clock = state.topics[topic]?.Remaining ?? state.session.clock;
      return [sessionEvent(ingestTime)];
    }

    case 'WeatherData': {
      state.topics[topic] = mergeDelta(state.topics[topic], data);
      const w = state.topics[topic] ?? {};
      return [{
        type: 'weather', ingestTime, sessionTime: null,
        payload: {
          airTemp: toNum(w.AirTemp),
          trackTemp: toNum(w.TrackTemp),
          wind: toNum(w.WindSpeed),
          windDir: toNum(w.WindDirection),
          humidity: toNum(w.Humidity),
          pressure: toNum(w.Pressure),
          rain: (toNum(w.Rainfall) ?? 0) > 0,
        },
      }];
    }

    // Heartbeat drives the adapter's watchdog; nothing to show. The rest of the
    // topic superset (TimingStats, TopThree, TeamRadio, …) is recorded to disk by
    // the recorder but has no dashboard panel yet — deliberately dropped here.
    default:
      return [];
  }
}

function sessionEvent(ingestTime) {
  return { type: 'session', ingestTime, sessionTime: null, payload: { ...state.session } };
}
