// ============================================================================
// A RACE WEEKEND
//
// Sessions appear one at a time as the spoiler line passes them, so this page is
// built to be legitimately half-empty: qualifying and the grid on Saturday, the
// race still under lock until Sunday evening. A sealed session shows a padlock,
// not a blank table — the difference matters, because "nothing to show yet" and
// "nobody set a time" are different facts.
// ============================================================================

import { el, points, date } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get } from '../lib/api.js';
import { teamColour } from '../lib/teams.js';
import { slopeChart } from '../components/chart.js';

/** A card standing in for a session the line hasn't reached. */
function sealed(title, note) {
  return el('div.card', null,
    el('div.head', null, icon('lock', 15), el('h2', { text: title })),
    el('div.body', null, el('div.empty', null,
      el('div', { style: 'margin-bottom:6px', text: note }),
      el('div', { style: 'font-size:11.5px',
        text: 'Advance your spoiler line past this session to see it.' }),
    )),
  );
}

function driverCell(row) {
  return el('td', null,
    el('span.teambar', { style: `background:${teamColour(row.constructorId)}` }),
    el('span.drv-code', { text: row.abbreviation }),
    el('span.drv-name', { text: ` ${row.driver}` }),
  );
}

/** Winner shows an elapsed time; everyone else shows their gap to it. */
function timeCell(row, i) {
  if (row.position === 1) return row.time ?? '—';
  if (row.gapLaps) return `+${row.gapLaps} lap${row.gapLaps === 1 ? '' : 's'}`;
  if (row.gap) return row.gap;
  return row.retired ?? row.positionText ?? '—';
}

function resultsTable(results) {
  return el('div.scroll-x', null, el('table.data', null,
    el('thead', null, el('tr', null,
      el('th.pos', { text: '#' }),
      el('th', { text: 'Driver' }),
      el('th.opt-sm', { text: 'Team' }),
      el('th.num.opt-xs', { text: 'Grid' }),
      el('th.num.opt-xs', { text: '+/−' }),
      el('th.num.opt-sm', { text: 'Laps' }),
      el('th.num', { text: 'Time / gap' }),
      el('th.num', { text: 'Pts' }),
    )),
    el('tbody', null, ...results.map((row, i) => el('tr', null,
      el('td.pos', { text: row.positionText ?? '—' }),
      driverCell(row),
      el('td.opt-sm.muted', { text: row.constructor }),
      el('td.num.muted.opt-xs', { text: row.grid ? String(row.grid) : '—' }),
      el('td.num.opt-xs', {
        style: `color:${row.gained > 0 ? 'var(--green)' : row.gained < 0 ? 'var(--redk)' : 'var(--ink3)'}`,
        text: row.gained ? (row.gained > 0 ? `+${row.gained}` : String(row.gained)) : '—',
      }),
      el('td.num.muted.opt-sm', { text: row.laps ?? '—' }),
      el('td.num', {
        class: row.position ? null : 'muted',
        title: row.retired ?? '',
        text: timeCell(row, i),
      }),
      el('td.num', { style: row.points ? 'font-weight:700' : 'color:var(--ink3)',
        text: row.points ? points(row.points) : '—' }),
    ))),
  ));
}

function qualifyingTable(rows) {
  return el('div.scroll-x', null, el('table.data', null,
    el('thead', null, el('tr', null,
      el('th.pos', { text: '#' }),
      el('th', { text: 'Driver' }),
      el('th.num.opt-sm', { text: 'Q1' }),
      el('th.num.opt-sm', { text: 'Q2' }),
      el('th.num', { text: 'Q3' }),
      el('th.num.opt-xs', { text: 'Gap' }),
    )),
    el('tbody', null, ...rows.map((row) => el('tr', null,
      el('td.pos', { text: row.positionText ?? '—' }),
      driverCell(row),
      el('td.num.muted.opt-sm', { text: row.q1 ?? '—' }),
      el('td.num.muted.opt-sm', { text: row.q2 ?? '—' }),
      el('td.num', { style: 'font-weight:700', text: row.q3 ?? row.time ?? '—' }),
      el('td.num.muted.opt-xs', { text: row.gap ?? '—' }),
    ))),
  ));
}

/** Podium, fastest lap and driver of the day — the weekend's headline facts. */
function highlights(weekend) {
  const podium = (weekend.results ?? []).filter((r) => r.position && r.position <= 3);
  if (!podium.length) return null;

  return el('div.card', null,
    el('div.head', null, icon('trophy', 15), el('h2', { text: 'Headlines' })),
    el('div.stat-row', null,
      ...podium.map((row, i) => el('div.stat', null,
        el('div.k', { text: ['Winner', 'Second', 'Third'][i] }),
        el('div.v', { style: `font-size:${i === 0 ? 20 : 17}px`, text: row.driver }),
        el('div.muted', { style: 'font-size:11px', text: row.constructor }),
      )),
      weekend.fastestLap && el('div.stat', null,
        el('div.k', { text: 'Fastest lap' }),
        el('div.v', { style: 'font-size:17px', text: weekend.fastestLap.abbreviation }),
        el('div.muted', { style: 'font-size:11px',
          text: `${weekend.fastestLap.time} · lap ${weekend.fastestLap.lap}` }),
      ),
      weekend.driverOfTheDay && el('div.stat', null,
        el('div.k', { text: 'Driver of the day' }),
        el('div.v', { style: 'font-size:17px', text: weekend.driverOfTheDay.abbreviation }),
        el('div.muted', { style: 'font-size:11px',
          text: `${weekend.driverOfTheDay.percentage}% of the vote` }),
      ),
    ),
  );
}

/** How the afternoon moved the championship. */
function swingCard(swing) {
  if (!swing?.length) return null;
  return el('div.card', null,
    el('div.head', null, icon('chart', 15), el('h2', { text: 'Championship after this race' })),
    el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
      el('thead', null, el('tr', null,
        el('th.pos', { text: '#' }),
        el('th', { text: 'Driver' }),
        el('th.num', { text: 'Points' }),
        el('th.num', { text: 'Gained' }),
        el('th.num.opt-xs', { text: 'Was' }),
      )),
      el('tbody', null, ...swing.map((row) => {
        const moved = row.previousPosition ? row.previousPosition - row.position : 0;
        return el('tr', null,
          el('td.pos', { text: String(row.position) }),
          el('td', null, el('span.drv-code', { text: row.abbreviation })),
          el('td.num', { style: 'font-weight:700', text: points(row.points) }),
          el('td.num', { style: row.pointsGained ? 'color:var(--green)' : 'color:var(--ink3)',
            text: row.pointsGained ? `+${points(row.pointsGained)}` : '—' }),
          el('td.num.opt-xs', {
            style: `color:${moved > 0 ? 'var(--green)' : moved < 0 ? 'var(--redk)' : 'var(--ink3)'}`,
            text: row.previousPosition ? `P${row.previousPosition}` : '—',
          }),
        );
      })),
    ))),
  );
}

function pitStopCard(pitStops) {
  if (!pitStops?.length) return null;
  const withStops = pitStops.filter((p) => p.stops.length).sort((a, b) => a.stops.length - b.stops.length);
  if (!withStops.length) return null;

  return el('div.card', null,
    el('div.head', null, icon('clock', 15), el('h2', { text: 'Pit stops' }),
      el('span.hint', { text: 'stop laps, in order' })),
    el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
      el('thead', null, el('tr', null,
        el('th', { text: 'Driver' }),
        el('th.num', { text: 'Stops' }),
        el('th', { text: 'On laps' }),
        el('th.num.opt-sm', { text: 'Best' }),
      )),
      el('tbody', null, ...withStops.map((row) => {
        const best = row.stops.filter((s) => s.millis).sort((a, b) => a.millis - b.millis)[0];
        return el('tr', null,
          el('td', null, el('span.drv-code', { text: row.abbreviation })),
          el('td.num', { text: String(row.stops.length) }),
          el('td.muted', { style: 'font-family:var(--mono);font-size:12px',
            text: row.stops.map((s) => s.lap).join(', ') }),
          el('td.num.opt-sm.muted', { text: best?.time ?? '—' }),
        );
      })),
    ))),
  );
}

/** @param {{args:string[], year:number}} ctx  route is #/race/<year>/<round> */
export async function renderRace({ args, year }) {
  const round = Number(args[1]) || 1;
  const weekend = await get('/api/race', { year, round });
  const { race, revealed } = weekend;

  const slope = revealed.race ? slopeChart((weekend.results ?? []).map((row) => ({
    driver: row.abbreviation,
    colour: teamColour(row.constructorId),
    from: row.grid,
    to: row.position,
    retired: !row.position,
  }))) : null;

  return el('div', null,
    el('div.page-head', null,
      el('div', null,
        el('h1', { text: `${race.grandPrix} ${race.year}` }),
        el('div.sub', { text: `Round ${race.round} · ${date(race.date)} · ` },
          el('a', { href: `#/circuit/${race.circuitId}`, style: 'text-decoration:underline;text-underline-offset:2px',
            text: race.circuitName }),
          ` · ${race.laps} laps, ${race.distance} km`),
      ),
      el('span.spacer'),
      el('a.btn.small.ghost', { href: `#/calendar/${race.year}` }, icon('calendar', 14), 'Season'),
    ),

    revealed.race ? highlights(weekend)
      : sealed('This race is past your spoiler line', `The ${race.grandPrix} was run on ${date(race.date)}.`),

    revealed.race && el('div.grid-2', null,
      el('div.card', null,
        el('div.head', null, icon('flag', 15), el('h2', { text: 'Grid to finish' })),
        el('div.body', null, slope),
      ),
      el('div', null,
        swingCard(weekend.championship),
        pitStopCard(weekend.pitStops),
      ),
    ),

    revealed.race && el('div.card', null,
      el('div.head', null, icon('list', 15), el('h2', { text: 'Race classification' }),
        el('span.hint', { text: `${weekend.results.length} entries` })),
      el('div.body.flush', null, resultsTable(weekend.results)),
    ),

    revealed.sprint && weekend.sprint && el('div.card', null,
      el('div.head', null, icon('flag', 15), el('h2', { text: 'Sprint' })),
      el('div.body.flush', null, resultsTable(weekend.sprint)),
    ),

    revealed.qualifying
      ? el('div.card', null,
        el('div.head', null, icon('clock', 15), el('h2', { text: 'Qualifying' }),
          el('span.hint', { text: race.qualifyingFormat?.replaceAll('_', ' ') ?? '' })),
        el('div.body.flush', null, qualifyingTable(weekend.qualifying)),
      )
      : sealed('Qualifying is past your spoiler line',
        'The grid for this race is not available at your line.'),

    el('div', { style: 'display:flex;gap:8px;margin-top:6px' },
      round > 1 && el('a.btn.small.ghost', { href: `#/race/${race.year}/${round - 1}` }, '← Previous round'),
      el('a.btn.small.ghost', { href: `#/race/${race.year}/${round + 1}` }, 'Next round →'),
    ),
  );
}
