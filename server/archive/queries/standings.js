// ============================================================================
// CHAMPIONSHIP STANDINGS, as they stood at the spoiler line.
//
// The cheap trick that makes this whole dashboard possible: F1DB stores the
// championship table *after every single race* (race_driver_standing). So
// "standings as of my line" is not a recomputation — it is a lookup of the table
// as it was published after the last race you have seen.
//
// Everything layered on top of that (wins, poles, form, title permutations) is
// aggregated from per-session rows under the same gate. Nothing here reads F1DB's
// precomputed season or career totals; see the warning in ../spoiler.js.
// ============================================================================

import { all, get } from '../db.js';
import { revealed } from '../spoiler.js';

/**
 * Where the season sits at this line: the last race you have seen, how many rounds
 * are still to come, and how many points are still on the table.
 *
 * The points system is read out of the data rather than hard-coded — the maximum a
 * driver scored in one race this season IS the win value. That keeps permutations
 * correct across every era, from 8-for-a-win in 1950 to sprint weekends now.
 */
export function seasonContext(asOf, year) {
  const lastRace = get(`
    SELECT r.id, r.round, r.date, gp.short_name AS grandPrix
    FROM race r
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    WHERE r.year = :year AND ${revealed('race')}
      AND EXISTS (SELECT 1 FROM race_result rr WHERE rr.race_id = r.id)
    ORDER BY r.round DESC
    LIMIT 1
  `, { asOf, year });

  const totals = get(`
    SELECT
      (SELECT COUNT(*) FROM race WHERE year = :year) AS scheduledRounds,
      (SELECT COUNT(*) FROM race r WHERE r.year = :year AND NOT (${revealed('race')})) AS roundsRemaining,
      (SELECT COUNT(*) FROM race r WHERE r.year = :year AND r.sprint_race_date IS NOT NULL
         AND NOT (${revealed('sprintRace')})) AS sprintsRemaining
  `, { asOf, year }) ?? {};

  // The biggest single-race and single-sprint hauls actually recorded this season.
  // Falls back to the modern 25/8 before any race of a new season has been seen.
  const maxRace = get(`
    SELECT MAX(rr.points) AS p FROM race_result rr JOIN race r ON r.id = rr.race_id
    WHERE r.year = :year AND ${revealed('race')}
  `, { asOf, year })?.p ?? 25;
  const maxSprint = get(`
    SELECT MAX(sr.points) AS p FROM sprint_race_result sr JOIN race r ON r.id = sr.race_id
    WHERE r.year = :year AND ${revealed('sprintRace')}
  `, { asOf, year })?.p ?? 8;

  const roundsRemaining = totals.roundsRemaining ?? 0;
  const sprintsRemaining = totals.sprintsRemaining ?? 0;

  return {
    year,
    lastRace: lastRace ?? null,
    scheduledRounds: totals.scheduledRounds ?? 0,
    roundsRemaining,
    sprintsRemaining,
    maxPointsPerRace: maxRace,
    maxPointsPerSprint: maxSprint,
    // The most any driver could still add to their tally.
    pointsStillAvailable: roundsRemaining * maxRace + sprintsRemaining * maxSprint,
  };
}

/** Per-driver season tallies, counted from revealed race results only. */
function raceTallies(asOf, year) {
  const rows = all(`
    SELECT rr.driver_id AS driverId,
           COUNT(*)                                                AS starts,
           SUM(CASE WHEN rr.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
           SUM(CASE WHEN rr.position_number IS NULL THEN 1 ELSE 0 END) AS dnfs,
           SUM(CASE WHEN rr.fastest_lap = 1 THEN 1 ELSE 0 END)      AS fastestLaps,
           SUM(COALESCE(rr.points, 0))                             AS racePoints
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    WHERE r.year = :year AND ${revealed('race')}
    GROUP BY rr.driver_id
  `, { asOf, year });
  return new Map(rows.map((row) => [row.driverId, row]));
}

/**
 * Poles, counted from the STARTING GRID rather than from qualifying classification —
 * a pole is P1 on the grid, and grid penalties routinely move it. Gated on
 * qualifying, so a pole is visible on Saturday night even though Sunday is sealed.
 */
function poleTallies(asOf, year) {
  const rows = all(`
    SELECT sgp.driver_id AS driverId, COUNT(*) AS poles
    FROM starting_grid_position sgp
    JOIN race r ON r.id = sgp.race_id
    WHERE r.year = :year AND sgp.position_number = 1 AND ${revealed('qualifying')}
    GROUP BY sgp.driver_id
  `, { asOf, year });
  return new Map(rows.map((row) => [row.driverId, row.poles]));
}

/** Sprint points, kept separate because they are gated on their own session. */
function sprintPoints(asOf, year) {
  const rows = all(`
    SELECT sr.driver_id AS driverId, SUM(COALESCE(sr.points, 0)) AS points
    FROM sprint_race_result sr
    JOIN race r ON r.id = sr.race_id
    WHERE r.year = :year AND ${revealed('sprintRace')}
    GROUP BY sr.driver_id
  `, { asOf, year });
  return new Map(rows.map((row) => [row.driverId, row.points]));
}

/**
 * Recent finishes per driver, newest last — the row of form dots in the standings
 * table. Only revealed races contribute, so the strip simply gets shorter the
 * further back your line sits.
 */
function recentForm(asOf, year, keep = 5) {
  const rows = all(`
    SELECT rr.driver_id AS driverId, r.round, rr.position_number AS position,
           rr.position_text AS positionText
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    WHERE r.year = :year AND ${revealed('race')}
    ORDER BY r.round
  `, { asOf, year });
  const byDriver = new Map();
  for (const row of rows) {
    if (!byDriver.has(row.driverId)) byDriver.set(row.driverId, []);
    byDriver.get(row.driverId).push({ round: row.round, position: row.position, text: row.positionText });
  }
  for (const [id, list] of byDriver) byDriver.set(id, list.slice(-keep));
  return byDriver;
}

/**
 * The drivers' championship at the line.
 *
 * @returns {{context:object, standings:object[]}}
 */
export function driverStandings(asOf, year) {
  const context = seasonContext(asOf, year);
  if (!context.lastRace) return { context, standings: [] };

  const table = all(`
    SELECT rds.position_number AS position, rds.position_text AS positionText,
           rds.driver_id AS driverId, rds.points,
           -- driver.name is the name a driver is actually known by (Lewis Hamilton);
           -- driver.full_name is the legal one (Lewis Carl Davidson Hamilton), which
           -- belongs on a profile page and is far too long for a table cell.
           d.name, d.abbreviation, d.permanent_number AS number,
           co.alpha3_code AS nationality,
           -- The team they were driving for in the last race you have seen. Mid-season
           -- swaps are real, so this is a point-in-time fact, not a season constant.
           (SELECT c.name FROM race_result rr JOIN constructor c ON c.id = rr.constructor_id
             WHERE rr.race_id = :raceId AND rr.driver_id = rds.driver_id) AS constructor,
           (SELECT rr.constructor_id FROM race_result rr
             WHERE rr.race_id = :raceId AND rr.driver_id = rds.driver_id) AS constructorId
    FROM race_driver_standing rds
    JOIN driver d ON d.id = rds.driver_id
    JOIN country co ON co.id = d.nationality_country_id
    WHERE rds.race_id = :raceId
    ORDER BY rds.position_display_order
  `, { raceId: context.lastRace.id });

  const races = raceTallies(asOf, year);
  const poles = poleTallies(asOf, year);
  const sprints = sprintPoints(asOf, year);
  const form = recentForm(asOf, year);
  const leaderPoints = table[0]?.points ?? 0;

  const standings = table.map((row) => {
    const tally = races.get(row.driverId) ?? {};
    return {
      ...row,
      wins: tally.wins ?? 0,
      podiums: tally.podiums ?? 0,
      starts: tally.starts ?? 0,
      dnfs: tally.dnfs ?? 0,
      fastestLaps: tally.fastestLaps ?? 0,
      poles: poles.get(row.driverId) ?? 0,
      sprintPoints: sprints.get(row.driverId) ?? 0,
      gapToLeader: Math.round((leaderPoints - row.points) * 100) / 100,
      form: form.get(row.driverId) ?? [],
      // Mathematically alive: could they still out-score the leader's current total
      // if they took maximum points from everything left? Deliberately generous —
      // it answers "is it over?" and never claims a title has been won.
      stillMathematicallyAlive: row.points + context.pointsStillAvailable >= leaderPoints,
    };
  });

  return { context, standings };
}

/**
 * The constructors' championship at the line, with each team's points split
 * between its drivers — the "who is actually carrying this team" question.
 */
export function constructorStandings(asOf, year) {
  const context = seasonContext(asOf, year);
  if (!context.lastRace) return { context, standings: [] };

  const table = all(`
    SELECT rcs.position_number AS position, rcs.position_text AS positionText,
           rcs.constructor_id AS constructorId, rcs.points,
           c.name, co.alpha3_code AS nationality,
           em.name AS engine
    FROM race_constructor_standing rcs
    JOIN constructor c ON c.id = rcs.constructor_id
    JOIN country co ON co.id = c.country_id
    JOIN engine_manufacturer em ON em.id = rcs.engine_manufacturer_id
    WHERE rcs.race_id = :raceId
    ORDER BY rcs.position_display_order
  `, { raceId: context.lastRace.id });

  // Wins and one-twos, counted per constructor over revealed races.
  const perTeam = new Map(all(`
    SELECT rr.constructor_id AS constructorId,
           SUM(CASE WHEN rr.position_number = 1  THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN rr.position_number <= 3 THEN 1 ELSE 0 END) AS podiums
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    WHERE r.year = :year AND ${revealed('race')}
    GROUP BY rr.constructor_id
  `, { asOf, year }).map((row) => [row.constructorId, row]));

  // A one-two is a race where the same team took both of the top two places.
  const oneTwos = new Map(all(`
    SELECT constructor_id AS constructorId, COUNT(*) AS oneTwos FROM (
      SELECT rr.race_id, rr.constructor_id, COUNT(*) AS topTwo
      FROM race_result rr
      JOIN race r ON r.id = rr.race_id
      WHERE r.year = :year AND rr.position_number <= 2 AND ${revealed('race')}
      GROUP BY rr.race_id, rr.constructor_id
      HAVING topTwo = 2
    )
    GROUP BY constructor_id
  `, { asOf, year }).map((row) => [row.constructorId, row.oneTwos]));

  // Points each driver contributed to their team, race + sprint.
  const contributions = all(`
    SELECT constructorId, driverId, name, abbreviation, SUM(points) AS points FROM (
      SELECT rr.constructor_id AS constructorId, rr.driver_id AS driverId,
             d.name, d.abbreviation, COALESCE(rr.points, 0) AS points
      FROM race_result rr
      JOIN race r ON r.id = rr.race_id
      JOIN driver d ON d.id = rr.driver_id
      WHERE r.year = :year AND ${revealed('race')}
      UNION ALL
      SELECT sr.constructor_id, sr.driver_id, d.name, d.abbreviation, COALESCE(sr.points, 0)
      FROM sprint_race_result sr
      JOIN race r ON r.id = sr.race_id
      JOIN driver d ON d.id = sr.driver_id
      WHERE r.year = :year AND ${revealed('sprintRace')}
    )
    GROUP BY constructorId, driverId
    ORDER BY points DESC
  `, { asOf, year });

  const byTeam = new Map();
  for (const row of contributions) {
    if (!byTeam.has(row.constructorId)) byTeam.set(row.constructorId, []);
    byTeam.get(row.constructorId).push(row);
  }

  const leaderPoints = table[0]?.points ?? 0;
  const standings = table.map((row) => ({
    ...row,
    wins: perTeam.get(row.constructorId)?.wins ?? 0,
    podiums: perTeam.get(row.constructorId)?.podiums ?? 0,
    oneTwos: oneTwos.get(row.constructorId) ?? 0,
    gapToLeader: Math.round((leaderPoints - row.points) * 100) / 100,
    drivers: byTeam.get(row.constructorId) ?? [],
  }));

  return { context, standings };
}

/**
 * Cumulative championship points by round, for the progression chart. One entry per
 * driver with a sparse series — a driver who joined mid-season simply starts later.
 */
export function pointsProgression(asOf, year, topN = 10) {
  const rows = all(`
    SELECT r.round, gp.short_name AS grandPrix, rds.driver_id AS driverId,
           d.abbreviation, rds.points, rds.position_number AS position
    FROM race_driver_standing rds
    JOIN race r ON r.id = rds.race_id
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    JOIN driver d ON d.id = rds.driver_id
    WHERE r.year = :year AND ${revealed('race')}
    ORDER BY r.round, rds.position_display_order
  `, { asOf, year });

  const rounds = [];
  const seenRounds = new Set();
  const series = new Map();
  for (const row of rows) {
    if (!seenRounds.has(row.round)) {
      seenRounds.add(row.round);
      rounds.push({ round: row.round, grandPrix: row.grandPrix });
    }
    if (!series.has(row.driverId)) {
      series.set(row.driverId, { driverId: row.driverId, abbreviation: row.abbreviation, points: [] });
    }
    series.get(row.driverId).points.push({ round: row.round, points: row.points, position: row.position });
  }

  // Chart the front of the field; twenty overlapping lines say nothing.
  const ranked = [...series.values()]
    .sort((a, b) => (b.points.at(-1)?.points ?? 0) - (a.points.at(-1)?.points ?? 0))
    .slice(0, topN);

  return { rounds, series: ranked };
}
