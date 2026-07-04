// SIM SOURCE — a lightweight fake race generator so the skeleton runs end-to-end with
// NO live feed. It emits normalized events directly (bypassing decode/normalize), which
// is enough to prove the buffer → WebSocket → browser path and exercise the transport
// controls. Swap SOURCE=signalr once the real adapter is built.
//
// This is deliberately simpler than the rich in-browser simulator in the demo — its job
// is to feed the SERVER pipeline, not to look pretty. The demo's own client-side sim
// remains available in the browser via ?sim=1.

const GRID = [
  ['VER', 1, 'RBR', '#3671C6'], ['NOR', 4, 'McL', '#FF8000'], ['LEC', 16, 'FER', '#E8002D'],
  ['PIA', 81, 'McL', '#FF8000'], ['RUS', 63, 'MER', '#27F4D2'], ['HAM', 44, 'FER', '#E8002D'],
  ['ALO', 14, 'AST', '#229971'], ['SAI', 55, 'WIL', '#64C4FF'], ['ALB', 23, 'WIL', '#64C4FF'],
  ['GAS', 10, 'ALP', '#00A1E8'],
];

export class SimSource {
  /**
   * @param {(event:object)=>void} emit  receives normalized events {type, ingestTime, payload}
   */
  constructor(emit) {
    this.emit = emit;
    this.timer = null;
    this.t = 0;
    this.cars = GRID.map((g, i) => ({
      num: g[1], code: g[0], team: g[2], colour: g[3],
      prog: -i * 0.002, lap: 1, lastLap: 90 + i * 0.3, compound: i < 5 ? 'S' : 'M', age: i % 4,
    }));
  }

  start() {
    // Announce the grid once so a live-mode frontend could build its roster.
    this.emit({ type: 'driverList', ingestTime: Date.now(),
      payload: this.cars.map(c => ({ num: c.num, code: c.code, team: c.team, colour: c.colour })) });

    // ~10 Hz update, similar cadence to the real car_data channel.
    this.timer = setInterval(() => this._tick(), 100);
  }

  _tick() {
    this.t += 0.1;
    const now = Date.now();
    for (const c of this.cars) {
      // crude lap around a loop; speed oscillates like corners/straights
      const corner = (Math.sin(c.prog * Math.PI * 8) + 1) / 2;      // 0..1
      const speed = Math.round(90 + (1 - corner) * 240);
      c.prog += speed / 3.6 / 5300 * 0.1;
      const throttle = corner < 0.4 ? 100 : Math.round((1 - corner) * 100);
      const brake = corner > 0.6 ? Math.round(corner * 100) : 0;
      const gear = Math.min(8, 1 + Math.floor(speed / 40));
      const drs = corner < 0.15 && speed > 250;

      this.emit({ type: 'carData', ingestTime: now,
        payload: { num: c.num, speed, throttle, brake, gear, rpm: 9000 + (speed % 60) * 60, drs } });
      this.emit({ type: 'position', ingestTime: now,
        payload: { num: c.num, x: Math.cos(c.prog * 6.28) * 1000, y: Math.sin(c.prog * 6.28) * 700, onTrack: true } });
    }
    // occasional timing + weather so those event types flow too
    if (Math.floor(this.t * 10) % 20 === 0) {
      const ordered = [...this.cars].sort((a, b) => b.prog - a.prog);
      ordered.forEach((c, i) => this.emit({ type: 'timing', ingestTime: now,
        payload: { num: c.num, pos: i + 1, gap: i === 0 ? 0 : (ordered[0].prog - c.prog) * 90,
          lastLap: c.lastLap, compound: c.compound, age: Math.floor(c.age + c.prog) } }));
      this.emit({ type: 'weather', ingestTime: now,
        payload: { airTemp: 23, trackTemp: 41, wind: 2.1, humidity: 44, rain: 0 } });
    }
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}
