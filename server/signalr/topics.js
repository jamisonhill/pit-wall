// The ~20 topics the F1 Live Timing feed exposes. Subscribe to the whole set and
// use what you need. `CarData.z` and `Position.z` are raw-DEFLATE-compressed; the
// rest are JSON text. (Source: FastF1 fastf1/livetiming/client.py `self.topics`.)

export const TOPICS = [
  'Heartbeat',
  'CarData.z',          // per-driver telemetry: Speed, RPM, nGear, Throttle, Brake, DRS (raw DEFLATE)
  'Position.z',         // per-driver GPS X/Y/Z in 1/10 m + on/off track (raw DEFLATE)
  'TimingData',         // positions, gaps, intervals, sector times, micro-sector Segments, laps
  'TimingStats',        // speed-trap bests (I1/I2/FL/ST), session bests
  'TimingAppData',      // tyre compound, stint, tyre age
  'WeatherData',        // air/track temp, wind, humidity, pressure, rainfall
  'RaceControlMessages',// flags, SC/VSC, investigations, penalties, lap deletions
  'TrackStatus',        // green/yellow/SC/VSC/red
  'SessionInfo',        // GP + session name, meeting info
  'SessionStatus',      // started/finished/etc.
  'SessionData',
  'DriverList',         // source of truth for driver number/code/team/colour
  'LapCount',           // current / total laps
  'ExtrapolatedClock',  // remaining time
  'TopThree',
  'RcmSeries',
  'TeamRadio',
  'AudioStreams',
  'ContentStreams',
];

// The compressed topics that must be raw-DEFLATE inflated before JSON parsing.
export const COMPRESSED_TOPICS = new Set(['CarData.z', 'Position.z']);
