// SEASON SCHEDULE — "when is the data live again?"
//
// The F1 SignalR feed only knows about the CURRENT session; between sessions it
// goes quiet with no hint of what's next. This module fetches the season calendar
// from the Ergast-compatible jolpica API (no key needed) and answers: what is the
// next session, and when does it start? The dashboard shows it whenever no
// session is live.
//
// Resilience: the schedule is cached for hours; a fetch failure is logged and
// returns null (the dashboard simply omits the line) — never throws.

import { log } from './logger.js';

const SCHEDULE_URL = 'https://api.jolpi.ca/ergast/f1/current.json';
const CACHE_MS = 6 * 60 * 60 * 1000;   // schedule barely changes — refetch every 6h
const RETRY_MS = 10 * 60 * 1000;       // after a failed fetch, try again in 10 min

let cache = { sessions: null, fetchedAt: 0 };

// Ergast race objects carry the extra sessions under these keys.
const SESSION_KEYS = [
  ['FirstPractice', 'Practice 1'],
  ['SecondPractice', 'Practice 2'],
  ['ThirdPractice', 'Practice 3'],
  ['SprintQualifying', 'Sprint Qualifying'],
  ['Sprint', 'Sprint'],
  ['Qualifying', 'Qualifying'],
];

/** Flatten the season into [{ label, startUtc }] sorted by time. */
function flattenSchedule(races) {
  const sessions = [];
  for (const race of races) {
    for (const [key, name] of SESSION_KEYS) {
      const s = race[key];
      if (s?.date && s?.time) {
        sessions.push({ label: `${race.raceName} — ${name}`, startUtc: `${s.date}T${s.time}` });
      }
    }
    if (race.date && race.time) {
      sessions.push({ label: `${race.raceName} — Race`, startUtc: `${race.date}T${race.time}` });
    }
  }
  return sessions
    .filter((s) => !Number.isNaN(Date.parse(s.startUtc)))
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
}

async function getSessions() {
  const age = Date.now() - cache.fetchedAt;
  if (cache.sessions && age < CACHE_MS) return cache.sessions;
  if (!cache.sessions && age < RETRY_MS && cache.fetchedAt !== 0) return null; // recent failure — back off
  try {
    const res = await fetch(SCHEDULE_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const sessions = flattenSchedule(json?.MRData?.RaceTable?.Races ?? []);
    if (!sessions.length) throw new Error('schedule response contained no sessions');
    cache = { sessions, fetchedAt: Date.now() };
    log.info('Season schedule fetched', { sessions: sessions.length });
    return sessions;
  } catch (err) {
    log.warn('Season schedule fetch failed; next-session info unavailable', { error: String(err) });
    cache = { sessions: cache.sessions, fetchedAt: Date.now() }; // keep stale data if we had any
    return cache.sessions;
  }
}

/**
 * The next session that hasn't started yet, or null if unknown.
 * @returns {Promise<{label:string, startUtc:string}|null>}
 */
export async function nextSession() {
  const sessions = await getSessions();
  if (!sessions) return null;
  const now = Date.now();
  return sessions.find((s) => Date.parse(s.startUtc) > now) ?? null;
}
