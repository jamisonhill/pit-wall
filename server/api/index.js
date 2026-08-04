// ============================================================================
// THE STATS API
//
// Every route here reads the F1DB archive through the spoiler gate. The contract
// is deliberately blunt:
//
//   • a route that returns results REQUIRES ?asOf=<ISO timestamp>, and answers 400
//     without one. There is no "show me everything" default, because a default is
//     exactly how a spoiler escapes.
//   • a route that returns only names, dates and calendars needs no line at all —
//     knowing the Dutch GP is on 23 August tells you nothing about who won it.
//   • no archive yet (first boot, still downloading) answers 503 with the download
//     status, so the dashboard can say so plainly instead of rendering empty tables.
// ============================================================================

import { isReady, version as archiveVersion } from '../archive/db.js';
import { archiveStatus } from '../archive/download.js';
import { parseAsOf, SpoilerError, seasons, seasonCalendar, hiddenRoundCount } from '../archive/spoiler.js';
import {
  driverStandings, constructorStandings, pointsProgression, seasonContext,
} from '../archive/queries/standings.js';
import { raceWeekend } from '../archive/queries/races.js';
import {
  driverProfile, driverIndex, constructorProfile, constructorIndex,
} from '../archive/queries/people.js';
import { nextSession } from '../schedule.js';
import { log } from '../logger.js';

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    // Responses are cut to a specific spoiler line. Caching one and replaying it
    // against a different line is precisely the bug we cannot afford.
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** Read ?year=, defaulting to the current calendar year. */
function readYear(url) {
  const raw = url.searchParams.get('year');
  const year = raw ? Number(raw) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    throw new SpoilerError(`"${raw}" is not a season year.`);
  }
  return year;
}

// ---- Routes -----------------------------------------------------------------
// Each handler is (url) => body. Throwing SpoilerError yields a 400; anything else
// is a 500 and gets logged.

const routes = {
  /** Is the archive here yet, and which F1DB release is it? No line needed. */
  '/api/archive': () => ({
    ...archiveStatus,
    ready: isReady(),
    version: archiveVersion() ?? archiveStatus.version,
    // Credit where it is due — F1DB is CC BY 4.0 and asks for attribution.
    attribution: { name: 'F1DB', url: 'https://github.com/f1db/f1db', licence: 'CC BY 4.0' },
  }),

  /** Every season in the archive. A list of years cannot spoil anything. */
  '/api/seasons': () => ({ seasons: seasons() }),

  /**
   * A season's calendar, each round marked revealed / hidden / upcoming. This is
   * what the spoiler gate itself is built from, so it must work BEFORE a line
   * exists — pass asOf=1950-01-01 to see a season with everything sealed.
   */
  '/api/calendar': async (url) => {
    const asOf = parseAsOf(url.searchParams.get('asOf'));
    const year = readYear(url);
    return {
      year,
      rounds: seasonCalendar(asOf, year),
      hiddenRounds: hiddenRoundCount(asOf, year),
      // The next real-world session, from the live jolpica calendar. A schedule is
      // not a result, so this is shown regardless of where the line sits.
      next: await nextSession().catch(() => null),
    };
  },

  /** Both championships at the line, plus the points-progression series. */
  '/api/standings': (url) => {
    const asOf = parseAsOf(url.searchParams.get('asOf'));
    const year = readYear(url);
    const drivers = driverStandings(asOf, year);
    const constructors = constructorStandings(asOf, year);
    return {
      year,
      context: drivers.context,
      drivers: drivers.standings,
      constructors: constructors.standings,
      progression: pointsProgression(asOf, year),
    };
  },

  /** Just the season context — used by the header bar, which needs it on every page. */
  '/api/season-context': (url) => {
    const asOf = parseAsOf(url.searchParams.get('asOf'));
    const year = readYear(url);
    return { ...seasonContext(asOf, year), hiddenRounds: hiddenRoundCount(asOf, year) };
  },

  /**
   * One race weekend. Sessions the line hasn't reached come back as null, so the
   * page shows a lock rather than an empty table — and the sealed session's data
   * never leaves the server.
   */
  '/api/race': (url) => {
    const asOf = parseAsOf(url.searchParams.get('asOf'));
    const year = readYear(url);
    const round = Number(url.searchParams.get('round'));
    if (!Number.isInteger(round) || round < 1) throw new SpoilerError('A round number is required.');
    const weekend = raceWeekend(asOf, year, round);
    if (!weekend) throw new SpoilerError(`${year} has no round ${round}.`);
    return weekend;
  },

  /** A driver's career, every figure recomputed under the line. */
  '/api/driver': (url) => {
    const asOf = parseAsOf(url.searchParams.get('asOf'));
    const id = url.searchParams.get('id');
    if (!id) throw new SpoilerError('A driver id is required.');
    const profile = driverProfile(asOf, id);
    if (!profile) throw new SpoilerError(`No driver known as "${id}".`);
    return profile;
  },

  /** Drivers to browse or search. Only those with a start you have seen. */
  '/api/drivers': (url) => {
    const asOf = parseAsOf(url.searchParams.get('asOf'));
    const yearParam = url.searchParams.get('year');
    return {
      drivers: driverIndex(asOf, {
        year: yearParam ? readYear(url) : null,
        search: url.searchParams.get('q') || null,
      }),
    };
  },

  '/api/constructor': (url) => {
    const asOf = parseAsOf(url.searchParams.get('asOf'));
    const id = url.searchParams.get('id');
    if (!id) throw new SpoilerError('A constructor id is required.');
    const profile = constructorProfile(asOf, id);
    if (!profile) throw new SpoilerError(`No constructor known as "${id}".`);
    return profile;
  },

  '/api/constructors': (url) => {
    const asOf = parseAsOf(url.searchParams.get('asOf'));
    const yearParam = url.searchParams.get('year');
    return { constructors: constructorIndex(asOf, { year: yearParam ? readYear(url) : null }) };
  },
};

/** Routes that answer without an open archive (they don't touch the database). */
const WORKS_WITHOUT_ARCHIVE = new Set(['/api/archive']);

/**
 * Try to serve `url` from the stats API.
 * @returns {boolean} true if this request was handled (the caller should stop).
 */
export function handleApi(url, req, res) {
  const handler = routes[url.pathname];
  if (!handler) return false;

  if (!isReady() && !WORKS_WITHOUT_ARCHIVE.has(url.pathname)) {
    json(res, 503, {
      error: 'The F1 archive is not available yet.',
      archive: archiveStatus,
    });
    return true;
  }

  Promise.resolve()
    .then(() => handler(url, req))
    .then((body) => json(res, 200, body))
    .catch((err) => {
      if (err instanceof SpoilerError) {
        json(res, err.status, { error: err.message });
        return;
      }
      log.error('API request failed', { path: url.pathname, error: String(err) });
      json(res, 500, { error: 'Something went wrong reading the archive.' });
    });
  return true;
}
