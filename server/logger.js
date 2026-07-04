// Tiny structured logger. Kept dependency-free on purpose (the NAS is RAM-constrained
// and this is a single-viewer tool — no need for a logging framework).

function line(level, msg, extra) {
  const ts = new Date().toISOString();
  const tail = extra ? ' ' + JSON.stringify(extra) : '';
  // One line per event so `docker logs` stays greppable.
  console.log(`${ts} [${level}] ${msg}${tail}`);
}

export const log = {
  info: (msg, extra) => line('INFO', msg, extra),
  warn: (msg, extra) => line('WARN', msg, extra),
  // Errors are logged loudly but never crash the process — the feed is flaky by nature.
  error: (msg, extra) => line('ERROR', msg, extra),
};
