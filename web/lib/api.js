// The only way this app talks to the server.
//
// Every call goes through here so that attaching the spoiler line is not something
// a view can forget to do. `get()` refuses to send a request when no line is set,
// which mirrors the server refusing to answer one — the same rule enforced from
// both ends, so a mistake fails immediately and visibly instead of leaking.

import { asOf, hasLine } from './line.js';

/** An API call that failed. `status` distinguishes 400 (bad line) from 503 (no archive). */
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, params) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { /* a non-JSON error page is still an error */ }
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed (HTTP ${res.status})`, res.status, body);
  }
  return body;
}

/**
 * Fetch spoiler-gated data. The current line is attached as `asOf` automatically.
 * @param {string} path e.g. '/api/standings'
 * @param {object} [params] extra query parameters
 */
export function get(path, params) {
  if (!hasLine()) {
    // A view rendered before the gate is a bug. Fail here rather than sending a
    // request the server would (correctly) reject.
    return Promise.reject(new ApiError('No spoiler line is set.', 400, null));
  }
  return request(path, { ...params, asOf: asOf() });
}

/**
 * Fetch something that carries no results and therefore needs no line — the
 * archive's download status, the list of seasons that exist.
 */
export function getOpen(path, params) {
  return request(path, params);
}

/**
 * The calendar, fetched at an explicit moment rather than at the current line.
 * The gate itself needs this: to offer you a round to pick, it has to list the
 * season while you still have no line at all. Passing a date in 1950 lists every
 * round with all of them sealed.
 */
export function getCalendarAt(year, atIso) {
  return request('/api/calendar', { year, asOf: atIso });
}
