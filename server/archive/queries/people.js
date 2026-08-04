// ============================================================================
// DRIVERS AND CONSTRUCTORS
//
// Career pages, and the comparison enthusiasts reach for first: the teammate
// head-to-head. Same car, same strategy calls, same afternoon — it is the closest
// thing the sport has to a controlled experiment.
//
// EVERY total on these pages is recomputed from per-session rows under the spoiler
// gate. F1DB ships precomputed career columns (driver.total_race_wins and friends)
// and they are all-time figures: printing one would tell you a driver won a race
// you haven't watched yet. They are never read here. See ../spoiler.js, rule 2.
// ============================================================================

import { all, get } from '../db.js';
import { revealed } from '../spoiler.js';

// ---- Drivers ----------------------------------------------------------------

/** Biography. Not gated — where someone was born is not a race result. */
function driverBio(driverId) {
  return get(`
    SELECT d.id, d.name, d.full_name AS fullName, d.abbreviation,
           d.permanent_number AS number, d.date_of_birth AS dateOfBirth,
           d.date_of_death AS dateOfDeath, d.place_of_birth AS placeOfBirth,
           nat.name AS nationality, nat.alpha3_code AS nationalityCode,
           birth.name AS countryOfBirth
    FROM driver d
    JOIN country nat ON nat.id = d.nationality_country_id
    JOIN country birth ON birth.id = d.country_of_birth_country_id
    WHERE d.id = :driverId
  `, { driverId });
}

/**
 * Career totals as at the line.
 *
 * `entries` counts every race a driver was entered for; `starts` counts the ones
 * they actually took the lights for, which is what a strike rate should divide by.
 */
function driverCareer(asOf, driverId) {
  const race = get(`
    SELECT COUNT(*)                                                 AS entries,
           SUM(CASE WHEN rr.grid_position_number IS NOT NULL THEN 1 ELSE 0 END) AS starts,
           SUM(CASE WHEN rr.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
           SUM(CASE WHEN rr.position_number IS NULL THEN 1 ELSE 0 END) AS retirements,
           SUM(CASE WHEN rr.fastest_lap = 1 THEN 1 ELSE 0 END)      AS fastestLaps,
           SUM(CASE WHEN rr.grand_slam = 1 THEN 1 ELSE 0 END)       AS grandSlams,
           SUM(COALESCE(rr.points, 0))                              AS racePoints,
           SUM(rr.laps)                                             AS laps,
           MIN(rr.position_number)                                  AS bestFinish,
           AVG(rr.position_number)                                  AS avgFinish,
           AVG(rr.grid_position_number)                             AS avgGrid,
           MIN(r.year)                                              AS firstYear,
           MAX(r.year)                                              AS lastYear
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    WHERE rr.driver_id = :driverId AND ${revealed('race')}
  `, { asOf, driverId }) ?? {};

  // Poles come off the grid and are gated on qualifying, so a pole set on Saturday
  // counts even while Sunday is sealed.
  const poles = get(`
    SELECT COUNT(*) AS n, MIN(sgp.position_number) AS bestGrid
    FROM starting_grid_position sgp
    JOIN race r ON r.id = sgp.race_id
    WHERE sgp.driver_id = :driverId AND ${revealed('qualifying')} AND sgp.position_number = 1
  `, { asOf, driverId }) ?? {};

  const sprint = get(`
    SELECT COUNT(*) AS starts,
           SUM(CASE WHEN sr.position_number = 1 THEN 1 ELSE 0 END) AS wins,
           SUM(COALESCE(sr.points, 0)) AS points
    FROM sprint_race_result sr
    JOIN race r ON r.id = sr.race_id
    WHERE sr.driver_id = :driverId AND ${revealed('sprintRace')}
  `, { asOf, driverId }) ?? {};

  const dotd = get(`
    SELECT COUNT(*) AS n
    FROM driver_of_the_day_result dotd
    JOIN race r ON r.id = dotd.race_id
    WHERE dotd.driver_id = :driverId AND ${revealed('race')} AND dotd.position_number = 1
  `, { asOf, driverId })?.n ?? 0;

  const entries = race.entries ?? 0;
  const starts = race.starts ?? 0;
  return {
    entries,
    starts,
    wins: race.wins ?? 0,
    podiums: race.podiums ?? 0,
    poles: poles.n ?? 0,
    fastestLaps: race.fastestLaps ?? 0,
    grandSlams: race.grandSlams ?? 0,
    retirements: race.retirements ?? 0,
    driverOfTheDay: dotd,
    points: Math.round(((race.racePoints ?? 0) + (sprint.points ?? 0)) * 100) / 100,
    laps: race.laps ?? 0,
    bestFinish: race.bestFinish ?? null,
    bestGrid: poles.bestGrid ?? null,
    avgFinish: race.avgFinish ? Math.round(race.avgFinish * 10) / 10 : null,
    avgGrid: race.avgGrid ? Math.round(race.avgGrid * 10) / 10 : null,
    firstYear: race.firstYear ?? null,
    lastYear: race.lastYear ?? null,
    sprintStarts: sprint.starts ?? 0,
    sprintWins: sprint.wins ?? 0,
    // Strike rates, which are what people actually compare across eras.
    winRate: starts ? Math.round((race.wins / starts) * 1000) / 10 : 0,
    podiumRate: starts ? Math.round((race.podiums / starts) * 1000) / 10 : 0,
    dnfRate: entries ? Math.round((race.retirements / entries) * 1000) / 10 : 0,
  };
}

/**
 * Titles won, counted the only spoiler-safe way there is.
 *
 * A championship is not a fact about a season — it is a fact about the *final
 * round* of that season. So: seasons where every round is behind the line, and
 * this driver topped the table after the last one. A season still in progress
 * contributes nothing, no matter how large the lead.
 */
function driverTitles(asOf, driverId) {
  return all(`
    SELECT r.year
    FROM race_driver_standing rds
    JOIN race r ON r.id = rds.race_id
    WHERE rds.driver_id = :driverId
      AND rds.position_number = 1
      AND ${revealed('race')}
      -- the last round of that season …
      AND r.round = (SELECT MAX(r2.round) FROM race r2 WHERE r2.year = r.year)
      -- … and the whole season is behind the line
      AND NOT EXISTS (
        SELECT 1 FROM race r3 WHERE r3.year = r.year AND NOT (${revealed('race', 'r3')})
      )
    ORDER BY r.year
  `, { asOf, driverId }).map((row) => row.year);
}

/** Season by season: where they finished, for whom, and how the year went. */
function driverSeasons(asOf, driverId) {
  return all(`
    SELECT r.year,
           COUNT(*)                                                 AS starts,
           SUM(CASE WHEN rr.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
           SUM(COALESCE(rr.points, 0))                              AS points,
           GROUP_CONCAT(DISTINCT c.name)                            AS constructors,
           -- Championship position after the last round of that season you have seen,
           -- which for a completed season is the final classification.
           (SELECT rds.position_number
              FROM race_driver_standing rds
              JOIN race rr2 ON rr2.id = rds.race_id
             WHERE rds.driver_id = :driverId AND rr2.year = r.year
               AND ${revealed('race', 'rr2')}
             ORDER BY rr2.round DESC LIMIT 1)                       AS championshipPosition
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN constructor c ON c.id = rr.constructor_id
    WHERE rr.driver_id = :driverId AND ${revealed('race')}
    GROUP BY r.year
    ORDER BY r.year DESC
  `, { asOf, driverId });
}

/**
 * Teammate head-to-head, per season — the comparison that strips out the car.
 *
 * A head-to-head only counts when BOTH drivers were classified: a teammate's
 * engine failure says nothing about who was quicker. Qualifying is compared on
 * the grid (after penalties, which is what the driver has to race from) and is
 * gated on qualifying, so it can be ahead of the race column.
 */
function driverTeammates(asOf, driverId) {
  const races = all(`
    SELECT r.year, mate.driver_id AS teammateId, d.name AS teammate,
           c.name AS constructor, mine.constructor_id AS constructorId,
           SUM(CASE WHEN mine.position_number IS NOT NULL AND mate.position_number IS NOT NULL
                     AND mine.position_number < mate.position_number THEN 1 ELSE 0 END) AS ahead,
           SUM(CASE WHEN mine.position_number IS NOT NULL AND mate.position_number IS NOT NULL
                     AND mine.position_number > mate.position_number THEN 1 ELSE 0 END) AS behind,
           SUM(COALESCE(mine.points, 0)) AS myPoints,
           SUM(COALESCE(mate.points, 0)) AS theirPoints
    FROM race_result mine
    JOIN race_result mate
      ON mate.race_id = mine.race_id
     AND mate.constructor_id = mine.constructor_id
     AND mate.driver_id <> mine.driver_id
    JOIN race r ON r.id = mine.race_id
    JOIN driver d ON d.id = mate.driver_id
    JOIN constructor c ON c.id = mine.constructor_id
    WHERE mine.driver_id = :driverId AND ${revealed('race')}
    GROUP BY r.year, mate.driver_id
    ORDER BY r.year DESC, ahead + behind DESC
  `, { asOf, driverId });

  const quali = new Map(all(`
    SELECT r.year || '|' || mate.driver_id AS key,
           SUM(CASE WHEN mine.position_number IS NOT NULL AND mate.position_number IS NOT NULL
                     AND mine.position_number < mate.position_number THEN 1 ELSE 0 END) AS ahead,
           SUM(CASE WHEN mine.position_number IS NOT NULL AND mate.position_number IS NOT NULL
                     AND mine.position_number > mate.position_number THEN 1 ELSE 0 END) AS behind
    FROM starting_grid_position mine
    JOIN starting_grid_position mate
      ON mate.race_id = mine.race_id
     AND mate.constructor_id = mine.constructor_id
     AND mate.driver_id <> mine.driver_id
    JOIN race r ON r.id = mine.race_id
    WHERE mine.driver_id = :driverId AND ${revealed('qualifying')}
    GROUP BY r.year, mate.driver_id
  `, { asOf, driverId }).map((row) => [row.key, row]));

  return races.map((row) => {
    const q = quali.get(`${row.year}|${row.teammateId}`) ?? { ahead: 0, behind: 0 };
    return {
      ...row,
      myPoints: Math.round(row.myPoints * 100) / 100,
      theirPoints: Math.round(row.theirPoints * 100) / 100,
      qualifyingAhead: q.ahead,
      qualifyingBehind: q.behind,
    };
  });
}

/** Where a driver has been strong, and where they have not. */
function driverCircuits(asOf, driverId) {
  return all(`
    SELECT c.id AS circuitId, c.name AS circuit, co.name AS country,
           COUNT(*)                                                 AS starts,
           SUM(CASE WHEN rr.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
           MIN(rr.position_number)                                  AS best,
           AVG(rr.position_number)                                  AS avgFinish
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN circuit c ON c.id = r.circuit_id
    JOIN country co ON co.id = c.country_id
    WHERE rr.driver_id = :driverId AND ${revealed('race')}
    GROUP BY c.id
    ORDER BY wins DESC, podiums DESC, starts DESC
  `, { asOf, driverId }).map((row) => ({
    ...row,
    avgFinish: row.avgFinish ? Math.round(row.avgFinish * 10) / 10 : null,
  }));
}

/** Every revealed result, for the career heat strip. */
function driverResults(asOf, driverId) {
  return all(`
    SELECT r.year, r.round, gp.short_name AS grandPrix,
           rr.position_number AS position, rr.position_text AS positionText
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    WHERE rr.driver_id = :driverId AND ${revealed('race')}
    ORDER BY r.year, r.round
  `, { asOf, driverId });
}

/** The whole driver page. */
export function driverProfile(asOf, driverId) {
  const bio = driverBio(driverId);
  if (!bio) return null;
  return {
    driver: bio,
    career: driverCareer(asOf, driverId),
    titles: driverTitles(asOf, driverId),
    seasons: driverSeasons(asOf, driverId),
    teammates: driverTeammates(asOf, driverId),
    circuits: driverCircuits(asOf, driverId),
    results: driverResults(asOf, driverId),
  };
}

/**
 * Drivers to offer in a picker or index. Only those with at least one revealed
 * start, so the list itself never hints at a debut you haven't seen.
 */
export function driverIndex(asOf, { year = null, search = null, limit = 400 } = {}) {
  return all(`
    SELECT d.id, d.name, d.abbreviation, co.alpha3_code AS nationality,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear,
           COUNT(*) AS starts,
           SUM(CASE WHEN rr.position_number = 1 THEN 1 ELSE 0 END) AS wins
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    JOIN country co ON co.id = d.nationality_country_id
    WHERE ${revealed('race')}
      AND (:year IS NULL OR r.year = :year)
      AND (:search IS NULL OR LOWER(d.name) LIKE '%' || LOWER(:search) || '%')
    GROUP BY d.id
    ORDER BY lastYear DESC, wins DESC, starts DESC
    LIMIT :limit
  `, { asOf, year, search, limit });
}

// ---- Constructors -----------------------------------------------------------

function constructorCareer(asOf, constructorId) {
  const race = get(`
    SELECT COUNT(DISTINCT rr.race_id)                               AS entries,
           SUM(CASE WHEN rr.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
           SUM(CASE WHEN rr.position_number IS NULL THEN 1 ELSE 0 END) AS retirements,
           SUM(CASE WHEN rr.fastest_lap = 1 THEN 1 ELSE 0 END)      AS fastestLaps,
           SUM(COALESCE(rr.points, 0))                              AS points,
           COUNT(*)                                                 AS carEntries,
           MIN(r.year)                                              AS firstYear,
           MAX(r.year)                                              AS lastYear
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    WHERE rr.constructor_id = :constructorId AND ${revealed('race')}
  `, { asOf, constructorId }) ?? {};

  const poles = get(`
    SELECT COUNT(*) AS n
    FROM starting_grid_position sgp
    JOIN race r ON r.id = sgp.race_id
    WHERE sgp.constructor_id = :constructorId AND sgp.position_number = 1
      AND ${revealed('qualifying')}
  `, { asOf, constructorId })?.n ?? 0;

  const oneTwos = get(`
    SELECT COUNT(*) AS n FROM (
      SELECT rr.race_id
      FROM race_result rr
      JOIN race r ON r.id = rr.race_id
      WHERE rr.constructor_id = :constructorId AND rr.position_number <= 2
        AND ${revealed('race')}
      GROUP BY rr.race_id
      HAVING COUNT(*) = 2
    )
  `, { asOf, constructorId })?.n ?? 0;

  return {
    entries: race.entries ?? 0,
    carEntries: race.carEntries ?? 0,
    wins: race.wins ?? 0,
    podiums: race.podiums ?? 0,
    poles,
    oneTwos,
    fastestLaps: race.fastestLaps ?? 0,
    retirements: race.retirements ?? 0,
    points: Math.round((race.points ?? 0) * 100) / 100,
    firstYear: race.firstYear ?? null,
    lastYear: race.lastYear ?? null,
    winRate: race.entries ? Math.round((race.wins / race.entries) * 1000) / 10 : 0,
  };
}

/** Constructors' titles — same "final round, fully revealed season" rule as drivers. */
function constructorTitles(asOf, constructorId) {
  return all(`
    SELECT r.year
    FROM race_constructor_standing rcs
    JOIN race r ON r.id = rcs.race_id
    WHERE rcs.constructor_id = :constructorId
      AND rcs.position_number = 1
      AND ${revealed('race')}
      AND r.round = (SELECT MAX(r2.round) FROM race r2 WHERE r2.year = r.year)
      AND NOT EXISTS (
        SELECT 1 FROM race r3 WHERE r3.year = r.year AND NOT (${revealed('race', 'r3')})
      )
    ORDER BY r.year
  `, { asOf, constructorId }).map((row) => row.year);
}

function constructorSeasons(asOf, constructorId) {
  return all(`
    SELECT r.year,
           COUNT(DISTINCT r.id)                                     AS rounds,
           SUM(CASE WHEN rr.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
           SUM(COALESCE(rr.points, 0))                              AS points,
           GROUP_CONCAT(DISTINCT em.name)                           AS engines,
           (SELECT rcs.position_number
              FROM race_constructor_standing rcs
              JOIN race r2 ON r2.id = rcs.race_id
             WHERE rcs.constructor_id = :constructorId AND r2.year = r.year
               AND ${revealed('race', 'r2')}
             ORDER BY r2.round DESC LIMIT 1)                        AS championshipPosition
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN engine_manufacturer em ON em.id = rr.engine_manufacturer_id
    WHERE rr.constructor_id = :constructorId AND ${revealed('race')}
    GROUP BY r.year
    ORDER BY r.year DESC
  `, { asOf, constructorId });
}

/** Who has driven for them, and what they did in the car. */
function constructorDrivers(asOf, constructorId) {
  return all(`
    SELECT d.id AS driverId, d.name, d.abbreviation,
           COUNT(*)                                                 AS starts,
           SUM(CASE WHEN rr.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
           SUM(COALESCE(rr.points, 0))                              AS points,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    WHERE rr.constructor_id = :constructorId AND ${revealed('race')}
    GROUP BY d.id
    ORDER BY wins DESC, points DESC, starts DESC
  `, { asOf, constructorId });
}

export function constructorProfile(asOf, constructorId) {
  const bio = get(`
    SELECT c.id, c.name, c.full_name AS fullName, co.name AS country,
           co.alpha3_code AS countryCode
    FROM constructor c
    JOIN country co ON co.id = c.country_id
    WHERE c.id = :constructorId
  `, { constructorId });
  if (!bio) return null;

  return {
    constructor: bio,
    career: constructorCareer(asOf, constructorId),
    titles: constructorTitles(asOf, constructorId),
    seasons: constructorSeasons(asOf, constructorId),
    drivers: constructorDrivers(asOf, constructorId),
  };
}

/** Constructors with at least one revealed entry. */
export function constructorIndex(asOf, { year = null, limit = 400 } = {}) {
  return all(`
    SELECT c.id, c.name, co.alpha3_code AS nationality,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear,
           COUNT(DISTINCT r.id) AS entries,
           SUM(CASE WHEN rr.position_number = 1 THEN 1 ELSE 0 END) AS wins
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN constructor c ON c.id = rr.constructor_id
    JOIN country co ON co.id = c.country_id
    WHERE ${revealed('race')}
      AND (:year IS NULL OR r.year = :year)
    GROUP BY c.id
    ORDER BY lastYear DESC, wins DESC, entries DESC
    LIMIT :limit
  `, { asOf, year, limit });
}
