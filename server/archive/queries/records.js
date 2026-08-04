// ============================================================================
// RECORDS AND HEAD-TO-HEAD
//
// The almanac. Every leaderboard here is recomputed at the spoiler line, which is
// the entire trick: "most career wins" is the statistic most likely to give away
// last Sunday, and it is exactly the one an F1 fan checks first.
//
// The head-to-head takes any two drivers from any era and compares them only over
// the races they actually both contested. Comparing Fangio's win rate with
// Verstappen's is a bar argument; comparing Hamilton and Rosberg over 2013–2016 is
// a measurement.
// ============================================================================

import { all, get } from '../db.js';
import { revealed } from '../spoiler.js';

/**
 * Career leaderboards. Each is the same shape so the page can render them
 * identically: rank, who, how many.
 *
 * `minStarts` keeps rate-based boards honest — a driver who entered one race and
 * won it does not have a 100% win rate worth printing.
 */
export function driverRecords(asOf, { limit = 15, minStarts = 40 } = {}) {
  const board = (metric) => all(`
    SELECT d.id, d.name, d.abbreviation, ${metric} AS value,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    WHERE ${revealed('race')}
    GROUP BY d.id
    HAVING value > 0
    ORDER BY value DESC, d.name
    LIMIT :limit
  `, { asOf, limit });

  const wins = board('SUM(CASE WHEN rr.position_number = 1 THEN 1 ELSE 0 END)');
  const podiums = board('SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END)');
  const starts = board('COUNT(*)');
  const points = board('SUM(COALESCE(rr.points, 0))');
  const fastestLaps = board('SUM(CASE WHEN rr.fastest_lap = 1 THEN 1 ELSE 0 END)');

  const poles = all(`
    SELECT d.id, d.name, d.abbreviation, COUNT(*) AS value,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM starting_grid_position sgp
    JOIN race r ON r.id = sgp.race_id
    JOIN driver d ON d.id = sgp.driver_id
    WHERE sgp.position_number = 1 AND ${revealed('qualifying')}
    GROUP BY d.id
    ORDER BY value DESC, d.name
    LIMIT :limit
  `, { asOf, limit });

  // Strike rate, restricted to drivers with a real sample behind them.
  const winRate = all(`
    SELECT d.id, d.name, d.abbreviation,
           ROUND(100.0 * SUM(CASE WHEN rr.position_number = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS value,
           COUNT(*) AS starts, MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    WHERE ${revealed('race')}
    GROUP BY d.id
    HAVING starts >= :minStarts AND value > 0
    ORDER BY value DESC
    LIMIT :limit
  `, { asOf, limit, minStarts });

  // Titles, using the same "season fully behind the line" rule as the driver page.
  const titles = all(`
    SELECT d.id, d.name, d.abbreviation, COUNT(*) AS value,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race_driver_standing rds
    JOIN race r ON r.id = rds.race_id
    JOIN driver d ON d.id = rds.driver_id
    WHERE rds.position_number = 1
      AND ${revealed('race')}
      AND r.round = (SELECT MAX(r2.round) FROM race r2 WHERE r2.year = r.year)
      AND NOT EXISTS (
        SELECT 1 FROM race r3 WHERE r3.year = r.year AND NOT (${revealed('race', 'r3')})
      )
    GROUP BY d.id
    ORDER BY value DESC, d.name
    LIMIT :limit
  `, { asOf, limit });

  return { titles, wins, podiums, poles, points, starts, fastestLaps, winRate };
}

export function constructorRecords(asOf, { limit = 15 } = {}) {
  const board = (metric) => all(`
    SELECT c.id, c.name, ${metric} AS value,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN constructor c ON c.id = rr.constructor_id
    WHERE ${revealed('race')}
    GROUP BY c.id
    HAVING value > 0
    ORDER BY value DESC, c.name
    LIMIT :limit
  `, { asOf, limit });

  const titles = all(`
    SELECT c.id, c.name, COUNT(*) AS value,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race_constructor_standing rcs
    JOIN race r ON r.id = rcs.race_id
    JOIN constructor c ON c.id = rcs.constructor_id
    WHERE rcs.position_number = 1
      AND ${revealed('race')}
      AND r.round = (SELECT MAX(r2.round) FROM race r2 WHERE r2.year = r.year)
      AND NOT EXISTS (
        SELECT 1 FROM race r3 WHERE r3.year = r.year AND NOT (${revealed('race', 'r3')})
      )
    GROUP BY c.id
    ORDER BY value DESC, c.name
    LIMIT :limit
  `, { asOf, limit });

  return {
    titles,
    wins: board('SUM(CASE WHEN rr.position_number = 1 THEN 1 ELSE 0 END)'),
    podiums: board('SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END)'),
    points: board('SUM(COALESCE(rr.points, 0))'),
    entries: board('COUNT(DISTINCT rr.race_id)'),
  };
}

/**
 * Oddities that don't fit a leaderboard. Each is a single row and each is gated,
 * so "youngest winner" can only ever name a race you have watched.
 */
export function milestones(asOf) {
  const youngestWinner = get(`
    SELECT d.name, d.abbreviation, r.year, gp.short_name AS grandPrix, r.date,
           CAST((julianday(r.date) - julianday(d.date_of_birth)) / 365.25 AS INT) AS years
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    WHERE rr.position_number = 1 AND ${revealed('race')}
    ORDER BY julianday(r.date) - julianday(d.date_of_birth)
    LIMIT 1
  `, { asOf });

  const oldestWinner = get(`
    SELECT d.name, d.abbreviation, r.year, gp.short_name AS grandPrix, r.date,
           CAST((julianday(r.date) - julianday(d.date_of_birth)) / 365.25 AS INT) AS years
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    WHERE rr.position_number = 1 AND ${revealed('race')}
    ORDER BY julianday(r.date) - julianday(d.date_of_birth) DESC
    LIMIT 1
  `, { asOf });

  // A win from the deepest grid slot — the best drive, by one crude measure.
  const furthestClimb = get(`
    SELECT d.name, d.abbreviation, r.year, gp.short_name AS grandPrix,
           rr.grid_position_number AS grid
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    WHERE rr.position_number = 1 AND rr.grid_position_number IS NOT NULL
      AND ${revealed('race')}
    ORDER BY rr.grid_position_number DESC
    LIMIT 1
  `, { asOf });

  // A grand slam is pole, win, fastest lap and every lap led — F1's rarest clean sweep.
  const grandSlams = all(`
    SELECT d.name, d.abbreviation, COUNT(*) AS value
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    WHERE rr.grand_slam = 1 AND ${revealed('race')}
    GROUP BY d.id
    ORDER BY value DESC
    LIMIT 8
  `, { asOf });

  return { youngestWinner, oldestWinner, furthestClimb, grandSlams };
}

/**
 * Two drivers, compared only over the races they both contested.
 *
 * Every count requires both drivers to have been classified. A comparison where
 * one car retired measures reliability, not driving, and lumping those in is how
 * head-to-head numbers get quoted misleadingly.
 */
export function headToHead(asOf, aId, bId) {
  const race = get(`
    SELECT COUNT(*) AS shared,
           SUM(CASE WHEN a.position_number IS NOT NULL AND b.position_number IS NOT NULL
                     AND a.position_number < b.position_number THEN 1 ELSE 0 END) AS aAhead,
           SUM(CASE WHEN a.position_number IS NOT NULL AND b.position_number IS NOT NULL
                     AND a.position_number > b.position_number THEN 1 ELSE 0 END) AS bAhead,
           SUM(CASE WHEN a.position_number IS NULL OR b.position_number IS NULL
                    THEN 1 ELSE 0 END) AS unclassified,
           SUM(CASE WHEN a.constructor_id = b.constructor_id THEN 1 ELSE 0 END) AS asTeammates,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race_result a
    JOIN race_result b ON b.race_id = a.race_id
    JOIN race r ON r.id = a.race_id
    WHERE a.driver_id = :aId AND b.driver_id = :bId AND ${revealed('race')}
  `, { asOf, aId, bId }) ?? {};

  const quali = get(`
    SELECT SUM(CASE WHEN a.position_number < b.position_number THEN 1 ELSE 0 END) AS aAhead,
           SUM(CASE WHEN a.position_number > b.position_number THEN 1 ELSE 0 END) AS bAhead
    FROM starting_grid_position a
    JOIN starting_grid_position b ON b.race_id = a.race_id
    JOIN race r ON r.id = a.race_id
    WHERE a.driver_id = :aId AND b.driver_id = :bId
      AND a.position_number IS NOT NULL AND b.position_number IS NOT NULL
      AND ${revealed('qualifying')}
  `, { asOf, aId, bId }) ?? {};

  // Per-driver totals across the shared races only, so the points column compares
  // like with like rather than one long career against one short one.
  const totals = (driverId, otherId) => get(`
    SELECT SUM(CASE WHEN me.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN me.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
           SUM(COALESCE(me.points, 0))                              AS points,
           MIN(me.position_number)                                  AS best,
           AVG(me.position_number)                                  AS avgFinish
    FROM race_result me
    JOIN race_result them ON them.race_id = me.race_id AND them.driver_id = :otherId
    JOIN race r ON r.id = me.race_id
    WHERE me.driver_id = :driverId AND ${revealed('race')}
  `, { asOf, driverId, otherId }) ?? {};

  const shape = (row) => ({
    wins: row.wins ?? 0,
    podiums: row.podiums ?? 0,
    points: Math.round((row.points ?? 0) * 100) / 100,
    best: row.best ?? null,
    avgFinish: row.avgFinish ? Math.round(row.avgFinish * 10) / 10 : null,
  });

  return {
    sharedRaces: race.shared ?? 0,
    asTeammates: race.asTeammates ?? 0,
    unclassified: race.unclassified ?? 0,
    firstYear: race.firstYear ?? null,
    lastYear: race.lastYear ?? null,
    raceRecord: { a: race.aAhead ?? 0, b: race.bAhead ?? 0 },
    qualifyingRecord: { a: quali.aAhead ?? 0, b: quali.bAhead ?? 0 },
    a: shape(totals(aId, bId)),
    b: shape(totals(bId, aId)),
  };
}
