// ============================================================================
// CIRCUITS
//
// Track facts are not spoilers — Monaco is 3.337 km whether or not you have
// watched this year's race. So the layout, length, corner count and history of
// visits are always available; only the results are gated.
//
// Two derived numbers here are the reason this page is worth building, because
// no results table shows them directly:
//
//   • pole-to-win conversion — how much a Saturday lap is actually worth at this
//     track. High at Monaco, where nobody overtakes; low at Interlagos.
//   • overtaking index — the mean absolute change between grid slot and finishing
//     position across every revealed race here. It is a blunt measure (a safety car
//     inflates it, a wet race inflates it a lot) but it separates the processions
//     from the races better than any single statistic in the sport.
// ============================================================================

import { all, get } from '../db.js';
import { revealed } from '../spoiler.js';

/** The circuit itself. Ungated: geography and geometry are not results. */
function circuitFacts(circuitId) {
  return get(`
    SELECT c.id, c.name, c.full_name AS fullName, c.previous_names AS previousNames,
           c.type, c.direction, c.place_name AS place,
           c.latitude, c.longitude, c.length, c.turns,
           co.name AS country, co.alpha3_code AS countryCode
    FROM circuit c
    JOIN country co ON co.id = c.country_id
    WHERE c.id = :circuitId
  `, { circuitId });
}

/**
 * Character of the place, from every race held here that is behind the line.
 *
 * `polesConverted` deliberately counts the pole-sitter winning, not the winner
 * starting from pole — those are different questions and this is the one people
 * mean when they ask whether qualifying matters at a circuit.
 */
function circuitCharacter(asOf, circuitId) {
  const races = get(`
    SELECT COUNT(DISTINCT r.id) AS racesHeld,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race r
    WHERE r.circuit_id = :circuitId AND ${revealed('race')}
      AND EXISTS (SELECT 1 FROM race_result rr WHERE rr.race_id = r.id)
  `, { asOf, circuitId }) ?? {};

  const field = get(`
    SELECT COUNT(*) AS starters,
           SUM(CASE WHEN rr.position_number IS NULL THEN 1 ELSE 0 END) AS retirements,
           AVG(CASE WHEN rr.position_number = 1 THEN rr.grid_position_number END) AS winnerAvgGrid
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    WHERE r.circuit_id = :circuitId AND ${revealed('race')}
      AND rr.grid_position_number IS NOT NULL
  `, { asOf, circuitId }) ?? {};

  /*
   * The overtaking index.
   *
   * The obvious version — average positions gained — measures the wrong thing.
   * Half the field retires at Monaco, so everyone who finishes "gains" places they
   * never overtook anyone for, and Monaco comes out as the most exciting track in
   * the sport. Which it is not.
   *
   * So: take only the cars that finished, rank them among THEMSELVES by grid slot,
   * and compare that with the order they finished in. Positions inherited from
   * retirements cancel out, and what is left is cars actually passing each other.
   * The resulting order reads correctly — Monaco, Catalunya and the Hungaroring at
   * the bottom, Interlagos, Silverstone and Bahrain at the top.
   */
  const overtaking = get(`
    WITH finishers AS (
      SELECT rr.race_id,
             RANK() OVER (PARTITION BY rr.race_id ORDER BY rr.grid_position_number) AS gridRank,
             RANK() OVER (PARTITION BY rr.race_id ORDER BY rr.position_number)      AS finishRank
      FROM race_result rr
      JOIN race r ON r.id = rr.race_id
      WHERE r.circuit_id = :circuitId AND ${revealed('race')}
        AND rr.position_number IS NOT NULL
        AND rr.grid_position_number IS NOT NULL
    )
    SELECT AVG(ABS(gridRank - finishRank)) AS churn FROM finishers
  `, { asOf, circuitId })?.churn ?? null;

  // Races here where the driver who started first also finished first.
  const poles = get(`
    SELECT COUNT(*) AS poleRaces,
           SUM(CASE WHEN rr.position_number = 1 THEN 1 ELSE 0 END) AS converted
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    WHERE r.circuit_id = :circuitId AND rr.grid_position_number = 1
      AND ${revealed('race')}
  `, { asOf, circuitId }) ?? {};

  // The outright fastest lap ever set here that you are allowed to know about.
  const lapRecord = get(`
    SELECT fl.time, fl.time_millis AS millis, d.name AS driver, d.abbreviation,
           c.name AS constructor, r.year, gp.short_name AS grandPrix
    FROM fastest_lap fl
    JOIN race r ON r.id = fl.race_id
    JOIN driver d ON d.id = fl.driver_id
    JOIN constructor c ON c.id = fl.constructor_id
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    WHERE r.circuit_id = :circuitId AND fl.time_millis IS NOT NULL AND ${revealed('race')}
    ORDER BY fl.time_millis
    LIMIT 1
  `, { asOf, circuitId });

  const starters = field.starters ?? 0;
  return {
    racesHeld: races.racesHeld ?? 0,
    firstYear: races.firstYear ?? null,
    lastYear: races.lastYear ?? null,
    dnfRate: starters ? Math.round((field.retirements / starters) * 1000) / 10 : null,
    // Mean places a finishing car moved relative to the other finishers. Around 2.5
    // is a racy circuit; under 2 is a procession.
    overtakingIndex: overtaking ? Math.round(overtaking * 100) / 100 : null,
    winnerAvgGrid: field.winnerAvgGrid ? Math.round(field.winnerAvgGrid * 10) / 10 : null,
    poleToWin: poles.poleRaces
      ? Math.round((poles.converted / poles.poleRaces) * 1000) / 10 : null,
    poleRaces: poles.poleRaces ?? 0,
    lapRecord: lapRecord ?? null,
  };
}

/** Every winner here, most recent first. */
function circuitWinners(asOf, circuitId) {
  return all(`
    SELECT r.year, r.round, gp.short_name AS grandPrix,
           rr.driver_id AS driverId, d.name AS driver, d.abbreviation,
           rr.constructor_id AS constructorId, c.name AS constructor,
           rr.grid_position_number AS fromGrid, rr.time
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    JOIN constructor c ON c.id = rr.constructor_id
    JOIN grand_prix gp ON gp.id = r.grand_prix_id
    WHERE r.circuit_id = :circuitId AND rr.position_number = 1 AND ${revealed('race')}
    ORDER BY r.year DESC, r.round DESC
  `, { asOf, circuitId });
}

/** Who owns the place — most wins by driver, and by constructor. */
function circuitMasters(asOf, circuitId) {
  const drivers = all(`
    SELECT rr.driver_id AS driverId, d.name, d.abbreviation,
           COUNT(*) AS wins
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN driver d ON d.id = rr.driver_id
    WHERE r.circuit_id = :circuitId AND rr.position_number = 1 AND ${revealed('race')}
    GROUP BY rr.driver_id
    ORDER BY wins DESC, d.name
    LIMIT 8
  `, { asOf, circuitId });

  const constructors = all(`
    SELECT rr.constructor_id AS constructorId, c.name, COUNT(*) AS wins
    FROM race_result rr
    JOIN race r ON r.id = rr.race_id
    JOIN constructor c ON c.id = rr.constructor_id
    WHERE r.circuit_id = :circuitId AND rr.position_number = 1 AND ${revealed('race')}
    GROUP BY rr.constructor_id
    ORDER BY wins DESC, c.name
    LIMIT 8
  `, { asOf, circuitId });

  return { drivers, constructors };
}

export function circuitProfile(asOf, circuitId) {
  const circuit = circuitFacts(circuitId);
  if (!circuit) return null;
  return {
    circuit,
    character: circuitCharacter(asOf, circuitId),
    winners: circuitWinners(asOf, circuitId),
    masters: circuitMasters(asOf, circuitId),
  };
}

/**
 * All circuits with at least one race you have seen, ordered by how recently they
 * were used. The count and "last visit" are gated, so a circuit added to the
 * calendar after your line does not appear as newly visited.
 */
export function circuitIndex(asOf) {
  return all(`
    SELECT c.id, c.name, c.place_name AS place, c.type, c.direction,
           c.length, c.turns, co.name AS country, co.alpha3_code AS countryCode,
           COUNT(DISTINCT r.id) AS racesHeld,
           MIN(r.year) AS firstYear, MAX(r.year) AS lastYear
    FROM race r
    JOIN circuit c ON c.id = r.circuit_id
    JOIN country co ON co.id = c.country_id
    WHERE ${revealed('race')}
      AND EXISTS (SELECT 1 FROM race_result rr WHERE rr.race_id = r.id)
    GROUP BY c.id
    ORDER BY lastYear DESC, racesHeld DESC
  `, { asOf });
}
