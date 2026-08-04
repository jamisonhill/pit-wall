// ============================================================================
// THE SPOILER LINE
//
// This is the load-bearing module of the whole dashboard. Everything else is a
// view onto data that has already passed through here.
//
// The rule: the visitor declares a moment in time — their "spoiler line" — and the
// site renders Formula 1 exactly as it stood then. A session that had not finished
// by that moment does not exist as far as the API is concerned.
//
// It is enforced HERE, in SQL, and not in the browser. A result that is past your
// line is never selected, never serialised, never sent. You cannot spoil yourself by
// opening the network tab, and a careless bit of front-end code cannot leak a result
// it was never given.
//
// ---------------------------------------------------------------------------
// THREE RULES, and why each one matters
//
// 1. No asOf, no data. Endpoints reject a request with no spoiler line (HTTP 400)
//    rather than defaulting to "everything". A forgotten parameter must fail
//    loudly, not quietly show you the title decider.
//
// 2. Never read F1DB's precomputed totals. Columns like driver.total_race_wins,
//    season_driver.total_points and race_driver_standing.championship_won hold
//    ALL-TIME values. "Verstappen: 68 wins" silently tells you he won last Sunday.
//    Career and record figures are recomputed from per-session rows filtered by
//    the line below. test/spoiler-audit.test.js fails the build if a query file
//    so much as mentions one of the forbidden columns.
//
// 3. The line only moves by hand. Nothing in this file advances it for you.
//
// ---------------------------------------------------------------------------
// SESSION GRANULARITY
//
// F1DB stores a separate date and time per session, so the line cuts between
// sessions of the same weekend, not just between weekends. Set it to Saturday
// evening and you can study qualifying while Sunday's result stays sealed.
// ============================================================================

import { all, get } from './db.js';

/**
 * How each kind of result is dated.
 *
 * `date`/`time` name the columns on the `race` table that say when that session
 * finished. When a session's own date is missing — common before the 1980s, where
 * F1DB records a race but no separate qualifying date — we fall back to the race
 * itself, which is the conservative choice: the result stays hidden until at least
 * the race weekend is behind your line.
 */
export const SESSIONS = {
  race:              { date: 'date',                    time: 'time' },
  qualifying:        { date: 'qualifying_date',         time: 'qualifying_time' },
  sprintRace:        { date: 'sprint_race_date',        time: 'sprint_race_time' },
  sprintQualifying:  { date: 'sprint_qualifying_date',  time: 'sprint_qualifying_time' },
  practice1:         { date: 'free_practice_1_date',    time: 'free_practice_1_time' },
  practice2:         { date: 'free_practice_2_date',    time: 'free_practice_2_time' },
  practice3:         { date: 'free_practice_3_date',    time: 'free_practice_3_time' },
};

/**
 * Which session's clock governs each results table. Get this mapping wrong and a
 * spoiler slips through, so it is spelled out explicitly rather than inferred.
 *
 * Note `starting_grid_position` is gated on QUALIFYING: the grid is public the
 * moment qualifying ends, long before the race runs.
 */
export const TABLE_SESSION = {
  race_result: 'race',
  fastest_lap: 'race',
  pit_stop: 'race',
  driver_of_the_day_result: 'race',
  race_driver_standing: 'race',
  race_constructor_standing: 'race',
  qualifying_result: 'qualifying',
  qualifying_1_result: 'qualifying',
  qualifying_2_result: 'qualifying',
  starting_grid_position: 'qualifying',
  sprint_race_result: 'sprintRace',
  sprint_starting_grid_position: 'sprintQualifying',
  sprint_qualifying_result: 'sprintQualifying',
  free_practice_1_result: 'practice1',
  free_practice_2_result: 'practice2',
  free_practice_3_result: 'practice3',
};

/**
 * SQL expression giving the datetime a session finished, as 'YYYY-MM-DD HH:MM:SS'.
 *
 * Two fallbacks are folded in:
 *   • no session date  → use the race's own date and time
 *   • no time at all   → 23:59, i.e. "some time that day". Historic races rarely
 *     record a start time, and end-of-day keeps them hidden for the whole of their
 *     race day rather than revealing them at midnight.
 *
 * @param {keyof SESSIONS} session
 * @param {string} alias  the SQL alias of the `race` table in the caller's query
 */
export function sessionEndedAt(session, alias = 'r') {
  const cols = SESSIONS[session];
  if (!cols) throw new Error(`unknown session "${session}"`);
  if (session === 'race') {
    return `datetime(${alias}.date || ' ' || COALESCE(${alias}.time, '23:59'))`;
  }
  // Only pair a session's time with its own date — never with the race's, which
  // falls on a different day and would compare nonsense.
  return `datetime(
    COALESCE(${alias}.${cols.date}, ${alias}.date) || ' ' ||
    COALESCE(
      CASE WHEN ${alias}.${cols.date} IS NOT NULL THEN ${alias}.${cols.time} ELSE ${alias}.time END,
      '23:59'
    )
  )`;
}

/**
 * The gate itself: a SQL boolean that is true only for sessions finished by the
 * visitor's line. Compose it into the WHERE clause of every query that touches a
 * result, and bind :asOf.
 *
 * @example
 *   `SELECT ... FROM race_result rr JOIN race r ON r.id = rr.race_id
 *    WHERE ${revealed('race')}`
 */
export function revealed(session, alias = 'r') {
  return `${sessionEndedAt(session, alias)} <= :asOf`;
}

/** The same gate for a named results table, so callers can't mismatch the pair. */
export function revealedForTable(table, alias = 'r') {
  const session = TABLE_SESSION[table];
  if (!session) throw new Error(`no spoiler rule defined for table "${table}"`);
  return revealed(session, alias);
}

// ---- Parsing the line off a request ----------------------------------------

/** SQLite's datetime() format, which our cutoff string must match to compare. */
function toSqlDateTime(ms) {
  // Always UTC. F1DB stores session times in local track time, but treating both
  // sides as naive wall-clock is right here: an hour of slop cannot leak a result,
  // because the next thing that happens is never less than an hour away.
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export class SpoilerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpoilerError';
    this.status = 400;
  }
}

/**
 * Validate the `asOf` query parameter and return it in SQLite's comparison format.
 * Throws SpoilerError (HTTP 400) when absent or unparseable — see rule 1 above.
 *
 * The value is clamped to the present. Asking for the future cannot reveal
 * anything (the data does not exist yet) but clamping keeps every downstream
 * "rounds remaining" calculation honest.
 *
 * @param {string|null|undefined} raw
 * @returns {string} e.g. '2026-07-26 18:00:00'
 */
export function parseAsOf(raw) {
  if (raw === undefined || raw === null || raw === '') {
    throw new SpoilerError('This endpoint requires an "asOf" spoiler line. Refusing to guess.');
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new SpoilerError(`Could not read "${raw}" as a date. Expected an ISO 8601 timestamp.`);
  }
  return toSqlDateTime(Math.min(ms, Date.now()));
}

// ---- Where the line sits ----------------------------------------------------

/**
 * The most recent race whose result is visible at this line. Standings "as of" the
 * line are simply the standings recorded after this race, which is why F1DB's
 * race_driver_standing table makes the whole design cheap.
 *
 * @returns {{id:number, year:number, round:number, date:string,
 *            grandPrix:string, circuitId:string, officialName:string}|null}
 */
export function latestRevealedRace(asOf) {
  return get(`
    SELECT r.id, r.year, r.round, r.date, r.official_name AS officialName,
           r.circuit_id AS circuitId, gp.short_name AS grandPrix
    FROM race r
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    WHERE ${revealed('race')}
      AND EXISTS (SELECT 1 FROM race_result rr WHERE rr.race_id = r.id)
    ORDER BY r.date DESC, r.round DESC
    LIMIT 1
  `, { asOf });
}

/**
 * Rounds of the given season that have been run but sit past the line — the number
 * behind "3 newer rounds hidden" in the header.
 *
 * Counting them is not a spoiler: a race calendar is public, and knowing a race
 * happened tells you nothing about who won it.
 */
export function hiddenRoundCount(asOf, year) {
  const row = get(`
    SELECT COUNT(*) AS n
    FROM race r
    WHERE r.year = :year
      AND NOT (${revealed('race')})
      AND EXISTS (SELECT 1 FROM race_result rr WHERE rr.race_id = r.id)
  `, { asOf, year });
  return row?.n ?? 0;
}

/**
 * The whole calendar for a season, each round flagged as revealed / run-but-hidden /
 * not yet run. This is what the gate screen and the calendar view are built from,
 * and it is deliberately spoiler-free: dates and names only, never a result.
 */
export function seasonCalendar(asOf, year) {
  return all(`
    SELECT r.id, r.round, r.date, r.time,
           gp.short_name AS grandPrix, r.official_name AS officialName,
           c.id AS circuitId, c.name AS circuitName, co.name AS country,
           CASE WHEN ${revealed('race')} THEN 1 ELSE 0 END AS revealedFlag,
           CASE WHEN EXISTS (SELECT 1 FROM race_result rr WHERE rr.race_id = r.id)
                THEN 1 ELSE 0 END AS hasResultFlag
    FROM race r
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    JOIN circuit c ON c.id = r.circuit_id
    JOIN country co ON co.id = c.country_id
    WHERE r.year = :year
    ORDER BY r.round
  `, { asOf, year }).map((row) => ({
    id: row.id,
    round: row.round,
    date: row.date,
    time: row.time,
    grandPrix: row.grandPrix,
    officialName: row.officialName,
    circuitId: row.circuitId,
    circuitName: row.circuitName,
    country: row.country,
    // 'revealed' — you may look. 'hidden' — it has been run, but it is past your
    // line. 'upcoming' — it has not happened yet, for anyone.
    state: row.revealedFlag ? 'revealed' : (row.hasResultFlag ? 'hidden' : 'upcoming'),
  }));
}

/** Seasons that exist in the archive, newest first. Never gated — years aren't spoilers. */
export function seasons() {
  return all('SELECT year FROM season ORDER BY year DESC').map((r) => r.year);
}
