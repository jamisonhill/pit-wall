// ============================================================================
// THE SPOILER LINE — client side
//
// The browser stores *what you chose*, not a frozen timestamp, and resolves it to
// an `asOf` moment at request time. That distinction matters: "I'm fully caught
// up" has to keep meaning "now" tomorrow as well, and a stored timestamp would
// quietly rot into a line three weeks in the past.
//
// The line never advances on its own. Nothing in this file moves it; only
// setLine(), called from the gate or the Advance button, does.
// ============================================================================

const STORAGE_KEY = 'pitwall.spoilerLine';

/**
 * @typedef {{mode:'round', year:number, round:number, at:string, label:string}
 *          |{mode:'season', year:number, label:string}
 *          |{mode:'live', label:string}} Line
 */

let current = read();

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const line = JSON.parse(raw);
    // Reject anything we don't recognise rather than limping along with it — a
    // half-understood line is worse than asking again.
    if (line?.mode === 'round' && line.year && line.round && line.at) return line;
    if (line?.mode === 'season' && line.year) return line;
    if (line?.mode === 'live') return line;
    return null;
  } catch {
    return null;
  }
}

/** The line currently in force, or null if the visitor has not set one. */
export function getLine() {
  return current;
}

export function hasLine() {
  return current !== null;
}

/** Is the visitor deliberately looking at up-to-the-minute data? */
export function isLive() {
  return current?.mode === 'live';
}

/** Set the line and remember it. Fires a 'spoilerline' event so views can redraw. */
export function setLine(line) {
  current = line;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(line)); }
  catch { /* private browsing: the line still works, it just won't outlive the tab */ }
  window.dispatchEvent(new CustomEvent('spoilerline', { detail: line }));
}

/** Forget the line entirely and go back to the gate. */
export function clearLine() {
  current = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clear */ }
  window.dispatchEvent(new CustomEvent('spoilerline', { detail: null }));
}

/**
 * Build the line for "I have watched through this round".
 *
 * The cutoff is the race's start time plus four hours — comfortably after the
 * chequered flag, and comfortably before anything else in the sport happens.
 * The server reveals a session when it started at or before the cutoff, so this
 * unseals exactly this race and nothing beyond it.
 */
export function lineForRound(round, year) {
  const start = Date.parse(`${round.date}T${round.time ?? '12:00'}:00Z`);
  const at = new Date((Number.isNaN(start) ? Date.parse(`${round.date}T23:59:00Z`) : start) + 4 * 3600_000);
  return {
    mode: 'round',
    year,
    round: round.round,
    at: at.toISOString(),
    label: `${year} R${round.round} · ${round.grandPrix}`,
  };
}

/** "Nothing newer than the end of this season." */
export function lineForSeason(year) {
  return { mode: 'season', year, label: `End of ${year}` };
}

/** "Show me everything." Only ever built behind an explicit confirmation. */
export function lineForLive() {
  return { mode: 'live', label: 'Up to the minute' };
}

/**
 * The current line as an ISO timestamp for the API's `asOf` parameter.
 * Throws if no line is set — a request must never go out without one.
 */
export function asOf() {
  if (!current) throw new Error('no spoiler line set');
  if (current.mode === 'live') return new Date().toISOString();     // resolved fresh, every time
  if (current.mode === 'season') return `${current.year}-12-31T23:59:59.000Z`;
  return current.at;
}

/**
 * The season a view should default to: the one your line sits in. Looking at the
 * end of 2019 should open on 2019, not on whatever year it happens to be today.
 */
export function defaultYear() {
  if (!current || current.mode === 'live') return new Date().getFullYear();
  return current.year;
}
