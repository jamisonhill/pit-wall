// ============================================================================
// CHAMPIONSHIP — the default view.
//
// Both title tables as they stood at the spoiler line, plus the two things
// enthusiasts actually argue about between races: how the points race has
// developed round by round, and whether it is mathematically over.
// ============================================================================

import { el, replace, points, gap, date } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get } from '../lib/api.js';
import { teamColour } from '../lib/teams.js';
import { pointsChart, chartLegend } from '../components/chart.js';

/** Recent-form dots: one square per race, coloured by how it went. */
function formStrip(form) {
  return el('div.form', null, ...form.map((race) => {
    const cls = race.position === 1 ? 'win'
      : race.position <= 3 ? 'podium'
      : race.position ? 'points'
      : 'out';
    return el('i', {
      class: cls,
      title: `Round ${race.round}: ${race.text}`,
      text: race.position ? String(race.position) : '·',
    });
  }));
}

function driversTable(standings) {
  const head = el('tr', null,
    el('th.pos', { text: '#' }),
    el('th', { text: 'Driver' }),
    el('th.opt-sm', { text: 'Team' }),
    el('th.num', { text: 'Pts' }),
    el('th.num.opt-xs', { text: 'Gap' }),
    el('th.num.opt-sm', { text: 'Wins' }),
    el('th.num.opt-sm', { text: 'Pod' }),
    el('th.num.opt-sm', { text: 'Pole' }),
    el('th.opt-xs', { text: 'Form' }),
  );

  const rows = standings.map((driver) => el('tr', null,
    el('td.pos', { text: driver.positionText ?? '—' }),
    el('td', null,
      el('span.teambar', { style: `background:${teamColour(driver.constructorId)}` }),
      el('a', { href: `#/driver/${driver.driverId}` },
        el('span.drv-code', { text: driver.abbreviation }),
        el('span.drv-name', { text: ` ${driver.name}` })),
    ),
    el('td.opt-sm.muted', null, driver.constructorId
      ? el('a', { href: `#/constructor/${driver.constructorId}`, text: driver.constructor })
      : '—'),
    el('td.num', { style: 'font-weight:800', text: points(driver.points) }),
    el('td.num.opt-xs.muted', { text: gap(driver.gapToLeader) }),
    el('td.num.opt-sm', { text: String(driver.wins) }),
    el('td.num.opt-sm', { text: String(driver.podiums) }),
    el('td.num.opt-sm', { text: String(driver.poles) }),
    el('td.opt-xs', null, formStrip(driver.form)),
  ));

  return el('div.scroll-x', null,
    el('table.data', null, el('thead', null, head), el('tbody', null, ...rows)));
}

function constructorsTable(standings) {
  const head = el('tr', null,
    el('th.pos', { text: '#' }),
    el('th', { text: 'Constructor' }),
    el('th.num', { text: 'Pts' }),
    el('th.num.opt-xs', { text: 'Gap' }),
    el('th.num.opt-sm', { text: 'Wins' }),
    el('th.num.opt-sm', { text: '1-2' }),
    el('th.opt-sm', { text: 'Points split' }),
  );

  const rows = standings.map((team) => {
    const colour = teamColour(team.constructorId);
    const total = team.drivers.reduce((sum, d) => sum + d.points, 0) || 1;
    // Who is carrying the team: each driver's share of the points, brightest first.
    const split = el('div.split', null, ...team.drivers.map((driver, i) => el('i', {
      style: `width:${(driver.points / total) * 100}%;background:${colour};opacity:${1 - i * 0.42}`,
      title: `${driver.name}: ${points(driver.points)}`,
    })));

    return el('tr', null,
      el('td.pos', { text: team.positionText ?? '—' }),
      el('td', null,
        el('span.teambar', { style: `background:${colour}` }),
        el('a', { href: `#/constructor/${team.constructorId}`, style: 'font-weight:700', text: team.name }),
        el('div.muted', { style: 'font-size:11px;margin-left:13px', text: team.engine }),
      ),
      el('td.num', { style: 'font-weight:800', text: points(team.points) }),
      el('td.num.opt-xs.muted', { text: gap(team.gapToLeader) }),
      el('td.num.opt-sm', { text: String(team.wins) }),
      el('td.num.opt-sm', { text: String(team.oneTwos) }),
      el('td.opt-sm', { style: 'min-width:140px' }, split,
        el('div.muted', { style: 'font-size:10.5px;margin-top:4px',
          text: team.drivers.map((d) => `${d.abbreviation} ${points(d.points)}`).join('  ·  ') })),
    );
  });

  return el('div.scroll-x', null,
    el('table.data', null, el('thead', null, head), el('tbody', null, ...rows)));
}

/**
 * Is the title still live? Answered only from data at or before the line: the
 * points already scored, and the maximum still on offer from the rounds that
 * remain. It never says a championship has been won — only whether it could
 * still be lost.
 */
function permutations(context, drivers) {
  const leader = drivers[0];
  if (!leader) return null;
  const alive = drivers.filter((d) => d.stillMathematicallyAlive);
  const decided = context.roundsRemaining > 0 && alive.length === 1;

  return el('div.card', null,
    el('div.head', null,
      el('h2', { text: 'Title permutations' }),
      el('span.hint', { text: `after ${context.lastRace.grandPrix}` }),
    ),
    el('div.stat-row', null,
      el('div.stat', null, el('div.k', { text: 'Rounds left' }),
        el('div.v', { text: String(context.roundsRemaining) })),
      el('div.stat', null, el('div.k', { text: 'Sprints left' }),
        el('div.v', { text: String(context.sprintsRemaining) })),
      el('div.stat', null, el('div.k', { text: 'Points available' }),
        el('div.v', { text: String(context.pointsStillAvailable) })),
      el('div.stat', null, el('div.k', { text: 'Leader’s cushion' }),
        el('div.v', null, points(leader.points - (drivers[1]?.points ?? 0)),
          el('small', { text: 'pts' }))),
      el('div.stat', null, el('div.k', { text: 'Still in it' }),
        el('div.v', { text: String(alive.length) })),
    ),
    el('div.body', null,
      context.roundsRemaining === 0
        ? el('div.muted', { text: 'The season is over at your spoiler line — every round has been run.' })
        : el('div', null,
          el('div', { style: 'margin-bottom:10px;font-size:13px' },
            decided
              ? `Only ${leader.name} can still reach the top of the table.`
              : `${alive.length} drivers can still out-score ${leader.name}’s current ${points(leader.points)} points.`,
          ),
          el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
            ...drivers.slice(0, 12).map((d) => el('span', {
              class: d.stillMathematicallyAlive ? 'pill alive' : 'pill out',
              title: d.stillMathematicallyAlive
                ? `Can still reach ${points(leader.points)}+ points`
                : `Cannot catch the leader even by winning everything left`,
              text: `${d.abbreviation} ${points(d.points)}`,
            })),
          ),
        ),
    ),
  );
}

function progressionCard(progression) {
  if (!progression.rounds.length) return null;
  const series = progression.series.map((s) => ({
    ...s,
    // Colour by the team the driver is scoring for, which is what the eye is
    // looking for in a chart of a championship.
    colour: teamColour(s.constructorId) ?? '#aab4c0',
  }));

  return el('div.card', null,
    el('div.head', null,
      el('h2', { text: 'Points progression' }),
      el('span.hint', { text: `rounds 1–${progression.rounds.at(-1).round}` }),
    ),
    chartLegend(series),
    el('div.body', null, pointsChart({ rounds: progression.rounds, series })),
  );
}

/** @param {{year:number}} ctx */
export async function renderStandings({ year }) {
  const data = await get('/api/standings', { year });
  const { context } = data;

  const page = el('div');

  if (!context.lastRace) {
    return replace(page,
      el('div.page-head', null, el('h1', { text: `${year} Championship` })),
      el('div.notice', null, icon('lock', 19), el('div.msg', null,
        el('b', { text: 'Nothing to show yet' }),
        `No round of the ${year} season has been run at your spoiler line. Move the line forward, or pick a different season.`,
      )),
    );
  }

  // The chart needs each driver's team colour, which lives on the standings rows.
  const colourByDriver = new Map(data.drivers.map((d) => [d.driverId, d.constructorId]));
  for (const s of data.progression.series) s.constructorId = colourByDriver.get(s.driverId);

  return replace(page,
    el('div.page-head', null,
      el('div', null,
        el('h1', { text: `${year} Championship` }),
        el('div.sub', { text: `As it stood after round ${context.lastRace.round}, the ${context.lastRace.grandPrix}, on ${date(context.lastRace.date)}.` }),
      ),
    ),

    permutations(context, data.drivers),

    el('div.card', null,
      el('div.head', null,
        icon('trophy', 15),
        el('h2', { text: 'Drivers’ championship' }),
        el('span.hint', { text: `${data.drivers.length} classified` }),
      ),
      el('div.body.flush', null, driversTable(data.drivers)),
    ),

    el('div.card', null,
      el('div.head', null,
        icon('flag', 15),
        el('h2', { text: 'Constructors’ championship' }),
        el('span.hint', { text: `${data.constructors.length} teams` }),
      ),
      el('div.body.flush', null, constructorsTable(data.constructors)),
    ),

    progressionCard(data.progression),
  );
}
