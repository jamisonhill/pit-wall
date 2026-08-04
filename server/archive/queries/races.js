// ============================================================================
// A RACE WEEKEND, session by session.
//
// The page this feeds is the one that answers "what actually happened?" — and
// because the spoiler line cuts between sessions, it can legitimately show you
// Saturday while Sunday is still sealed. Each session is fetched only if its own
// gate opens, and the page renders a lock where a session is missing.
//
// The most useful single thing here isn't the classification: it's the pairing of
// starting grid with finishing position. That difference is the race.
// ============================================================================

import { all, get } from '../db.js';
import { revealed } from '../spoiler.js';

/** Meta about the weekend itself — never gated, since a calendar isn't a result. */
export function raceMeta(asOf, year, round) {
  return get(`
    SELECT r.id, r.year, r.round, r.date, r.time, r.official_name AS officialName,
           r.laps, r.distance, r.course_length AS courseLength, r.turns,
           r.qualifying_format AS qualifyingFormat,
           r.sprint_race_date AS sprintDate,
           gp.short_name AS grandPrix, gp.full_name AS grandPrixFull,
           c.id AS circuitId, c.name AS circuitName, c.full_name AS circuitFullName,
           c.type AS circuitType, c.direction,
           co.name AS country,
           -- Which sessions may be shown at this line. Computed here rather than in
           -- the view so the browser is never told a session exists before it may
           -- see it.
           CASE WHEN ${revealed('race')} THEN 1 ELSE 0 END AS raceRevealed,
           CASE WHEN ${revealed('qualifying')} THEN 1 ELSE 0 END AS qualifyingRevealed,
           CASE WHEN r.sprint_race_date IS NOT NULL AND ${revealed('sprintRace')}
                THEN 1 ELSE 0 END AS sprintRevealed
    FROM race r
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    JOIN circuit c ON c.id = r.circuit_id
    JOIN country co ON co.id = c.country_id
    WHERE r.year = :year AND r.round = :round
  `, { asOf, year, round });
}

/** The classification, with grid position alongside so the page can pair them. */
function classification(raceId) {
  return all(`
    SELECT rr.position_number AS position, rr.position_text AS positionText,
           rr.driver_id AS driverId, d.name AS driver, d.abbreviation,
           rr.constructor_id AS constructorId, c.name AS constructor,
           rr.laps, rr.time, rr.gap, rr.gap_laps AS gapLaps, rr.interval,
           rr.reason_retired AS retired, rr.points,
           rr.grid_position_number AS grid, rr.positions_gained AS gained,
           rr.pit_stops AS pitStops, rr.fastest_lap AS fastestLap
    FROM race_result rr
    JOIN driver d ON d.id = rr.driver_id
    JOIN constructor c ON c.id = rr.constructor_id
    WHERE rr.race_id = :raceId
    ORDER BY rr.position_display_order
  `, { raceId });
}

function qualifying(raceId) {
  return all(`
    SELECT qr.position_number AS position, qr.position_text AS positionText,
           qr.driver_id AS driverId, d.name AS driver, d.abbreviation,
           qr.constructor_id AS constructorId, c.name AS constructor,
           qr.q1, qr.q2, qr.q3, qr.time, qr.gap, qr.interval
    FROM qualifying_result qr
    JOIN driver d ON d.id = qr.driver_id
    JOIN constructor c ON c.id = qr.constructor_id
    WHERE qr.race_id = :raceId
    ORDER BY qr.position_display_order
  `, { raceId });
}

function grid(raceId) {
  return all(`
    SELECT sgp.position_number AS position, sgp.position_text AS positionText,
           sgp.driver_id AS driverId, d.name AS driver, d.abbreviation,
           sgp.constructor_id AS constructorId,
           sgp.grid_penalty AS penalty, sgp.grid_penalty_positions AS penaltyPositions,
           sgp.time
    FROM starting_grid_position sgp
    JOIN driver d ON d.id = sgp.driver_id
    WHERE sgp.race_id = :raceId
    ORDER BY sgp.position_display_order
  `, { raceId });
}

function sprint(raceId) {
  return all(`
    SELECT sr.position_number AS position, sr.position_text AS positionText,
           sr.driver_id AS driverId, d.name AS driver, d.abbreviation,
           sr.constructor_id AS constructorId, c.name AS constructor,
           sr.laps, sr.time, sr.gap, sr.points,
           sr.grid_position_number AS grid, sr.positions_gained AS gained,
           sr.reason_retired AS retired
    FROM sprint_race_result sr
    JOIN driver d ON d.id = sr.driver_id
    JOIN constructor c ON c.id = sr.constructor_id
    WHERE sr.race_id = :raceId
    ORDER BY sr.position_display_order
  `, { raceId });
}

/** Pit stops, grouped per driver — the strategy story of the afternoon. */
function pitStops(raceId) {
  const rows = all(`
    SELECT ps.driver_id AS driverId, d.abbreviation, ps.stop, ps.lap, ps.time,
           ps.time_millis AS millis
    FROM pit_stop ps
    JOIN driver d ON d.id = ps.driver_id
    WHERE ps.race_id = :raceId
    ORDER BY ps.driver_id, ps.stop
  `, { raceId });
  const byDriver = new Map();
  for (const row of rows) {
    if (!byDriver.has(row.driverId)) {
      byDriver.set(row.driverId, { driverId: row.driverId, abbreviation: row.abbreviation, stops: [] });
    }
    byDriver.get(row.driverId).stops.push({ stop: row.stop, lap: row.lap, time: row.time, millis: row.millis });
  }
  return [...byDriver.values()];
}

/**
 * The standings immediately before and after this race — how the afternoon moved
 * the championship. "Before" is the standing after the previous round, which is
 * itself only readable because that round is behind the line too.
 */
function championshipSwing(raceId, year, round) {
  const after = all(`
    SELECT rds.position_number AS position, rds.driver_id AS driverId,
           d.abbreviation, rds.points
    FROM race_driver_standing rds
    JOIN driver d ON d.id = rds.driver_id
    WHERE rds.race_id = :raceId
    ORDER BY rds.position_display_order
    LIMIT 10
  `, { raceId });

  const before = round <= 1 ? [] : all(`
    SELECT rds.position_number AS position, rds.driver_id AS driverId, rds.points
    FROM race_driver_standing rds
    JOIN race r ON r.id = rds.race_id
    WHERE r.year = :year AND r.round = :prevRound
  `, { year, prevRound: round - 1 });

  const beforeById = new Map(before.map((row) => [row.driverId, row]));
  return after.map((row) => ({
    ...row,
    previousPosition: beforeById.get(row.driverId)?.position ?? null,
    pointsGained: Math.round((row.points - (beforeById.get(row.driverId)?.points ?? 0)) * 100) / 100,
  }));
}

/**
 * Everything about one race weekend that the spoiler line permits.
 *
 * Sessions that are still sealed come back as `null` rather than as empty arrays,
 * so the page can tell "nothing to show yet" apart from "nobody set a time".
 */
export function raceWeekend(asOf, year, round) {
  const meta = raceMeta(asOf, year, round);
  if (!meta) return null;

  const qualifyingRevealed = Boolean(meta.qualifyingRevealed);
  const raceRevealed = Boolean(meta.raceRevealed);
  const sprintRevealed = Boolean(meta.sprintRevealed);

  const fastest = raceRevealed ? get(`
    SELECT fl.driver_id AS driverId, d.name AS driver, d.abbreviation,
           c.name AS constructor, fl.lap, fl.time, fl.gap
    FROM fastest_lap fl
    JOIN driver d ON d.id = fl.driver_id
    JOIN constructor c ON c.id = fl.constructor_id
    WHERE fl.race_id = :raceId AND fl.position_number = 1
  `, { raceId: meta.id }) : null;

  const dotd = raceRevealed ? get(`
    SELECT dotd.driver_id AS driverId, d.name AS driver, d.abbreviation, dotd.percentage
    FROM driver_of_the_day_result dotd
    JOIN driver d ON d.id = dotd.driver_id
    WHERE dotd.race_id = :raceId AND dotd.position_number = 1
  `, { raceId: meta.id }) : null;

  return {
    // Strip the raw *Revealed integers; the booleans below are the contract.
    race: {
      id: meta.id, year: meta.year, round: meta.round, date: meta.date, time: meta.time,
      officialName: meta.officialName, grandPrix: meta.grandPrix, grandPrixFull: meta.grandPrixFull,
      laps: meta.laps, distance: meta.distance, courseLength: meta.courseLength, turns: meta.turns,
      qualifyingFormat: meta.qualifyingFormat, hasSprint: meta.sprintDate !== null,
      circuitId: meta.circuitId, circuitName: meta.circuitName,
      circuitFullName: meta.circuitFullName, circuitType: meta.circuitType,
      direction: meta.direction, country: meta.country,
    },
    revealed: { qualifying: qualifyingRevealed, race: raceRevealed, sprint: sprintRevealed },
    qualifying: qualifyingRevealed ? qualifying(meta.id) : null,
    grid: qualifyingRevealed ? grid(meta.id) : null,
    sprint: sprintRevealed ? sprint(meta.id) : null,
    results: raceRevealed ? classification(meta.id) : null,
    fastestLap: fastest,
    driverOfTheDay: dotd,
    pitStops: raceRevealed ? pitStops(meta.id) : null,
    championship: raceRevealed ? championshipSwing(meta.id, year, round) : null,
  };
}
