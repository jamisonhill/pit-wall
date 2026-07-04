// ============================================================================
// NORMALIZE  —  raw F1 topics → stable internal event schema.  ⚠️ Stub for Fable 5.
//
// The frontend must NEVER see a SignalR quirk. Map every raw topic into one of these
// typed events so the dashboard code stays clean and the feed can change shape
// without touching the UI:
//
//   { type, ingestTime, sessionTime, payload }
//
//   type          payload (target shape the frontend expects)
//   ───────────   ───────────────────────────────────────────────────────────────
//   driverList    [{ num, code, team, colour }]                (from DriverList)
//   session       { gp, session, lap, totalLaps, flag, clock } (SessionInfo/LapCount/TrackStatus)
//   carData       { num, speed, throttle, brake, gear, rpm, drs }   (CarData.z)
//   position      { num, x, y, onTrack }                       (Position.z)
//   timing        { num, pos, gap, interval, lastLap, bestLap, sectors[], pit, drs } (TimingData)
//   tyres         { num, compound, age, stint }                (TimingAppData)
//   weather       { airTemp, trackTemp, wind, humidity, rain } (WeatherData)
//   raceControl   { lap, category, message, flag }             (RaceControlMessages)
//
// This mirrors the fields the demo frontend already renders
// (reference/dashboard-demo.html) — match them so wiring is a 1:1 swap.
// ============================================================================

/**
 * @param {{topic:string,data:any,ingestTime:number}} msg
 * @returns {Array<{type:string,ingestTime:number,payload:any}>}  zero or more events
 */
export function normalize(msg) {
  const { topic, data, ingestTime } = msg;

  // TODO(Fable 5): implement the real mapping per topic. Below is a passthrough so the
  // pipeline is wired end-to-end; replace with typed events matching the table above.
  switch (topic) {
    // case 'CarData.z': return data.Entries.map(e => ({ type:'carData', ingestTime, payload:{...} }));
    // case 'Position.z': ...
    // case 'TimingData': ...
    // case 'DriverList': ...
    // case 'WeatherData': ...
    // case 'RaceControlMessages': ...
    default:
      return [{ type: 'raw', ingestTime, payload: { topic, data } }];
  }
}
