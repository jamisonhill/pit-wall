// ============================================================================
// A DRIVER'S CAREER
//
// Every number on this page is recomputed at the spoiler line, which is the whole
// point: a career total is a running total, and printing today's would tell you
// about races you haven't watched. Set your line to the end of 2016 and Hamilton
// has three titles here, because on that day he had three.
//
// The teammate head-to-head gets top billing because it is the comparison that
// controls for the car — same machinery, same pit wall, same afternoon.
// ============================================================================

import { el, points, date } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get } from '../lib/api.js';
import { teamColour } from '../lib/teams.js';

function statRow(career, titles) {
  const stat = (label, value, note) => el('div.stat', null,
    el('div.k', { text: label }),
    el('div.v', null, value, note && el('small', { text: note })),
  );
  return el('div.stat-row', null,
    stat('Titles', String(titles.length)),
    stat('Entries', String(career.entries)),
    stat('Wins', String(career.wins), `${career.winRate}%`),
    stat('Podiums', String(career.podiums), `${career.podiumRate}%`),
    stat('Poles', String(career.poles)),
    stat('Fastest laps', String(career.fastestLaps)),
    stat('Points', points(career.points)),
    stat('Avg grid', career.avgGrid ?? '—'),
    stat('Avg finish', career.avgFinish ?? '—'),
    stat('Retirements', String(career.retirements), `${career.dnfRate}%`),
  );
}

/**
 * Head-to-head against every teammate, season by season. Only races where both
 * cars were classified count — a teammate's blown engine is not a defeat.
 */
function teammateCard(teammates) {
  if (!teammates.length) return null;

  const bar = (mine, theirs) => {
    const total = mine + theirs || 1;
    return el('div.split', { style: 'width:120px' },
      el('i', { style: `width:${(mine / total) * 100}%;background:var(--green)` }),
      el('i', { style: `width:${(theirs / total) * 100}%;background:#3a2023` }),
    );
  };

  return el('div.card', null,
    el('div.head', null,
      icon('people', 15),
      el('h2', { text: 'Teammate head to head' }),
      el('span.hint', { text: 'only races both cars were classified' }),
    ),
    el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
      el('thead', null, el('tr', null,
        el('th.num', { text: 'Year' }),
        el('th', { text: 'Teammate' }),
        el('th.opt-sm', { text: 'Team' }),
        el('th.num', { text: 'Race' }),
        el('th.opt-xs', { text: '' }),
        el('th.num', { text: 'Quali' }),
        el('th.num.opt-sm', { text: 'Points' }),
      )),
      el('tbody', null, ...teammates.map((row) => el('tr', null,
        el('td.num.muted', { text: String(row.year) }),
        el('td', null,
          el('a', { href: `#/driver/${row.teammateId}`, style: 'font-weight:600', text: row.teammate }),
        ),
        el('td.opt-sm.muted', null,
          el('span.teambar', { style: `background:${teamColour(row.constructorId)}` }),
          row.constructor),
        el('td.num', {
          style: `font-weight:700;color:${row.ahead > row.behind ? 'var(--green)' : row.ahead < row.behind ? 'var(--redk)' : 'var(--ink)'}`,
          text: `${row.ahead}–${row.behind}`,
        }),
        el('td.opt-xs', null, bar(row.ahead, row.behind)),
        el('td.num', {
          style: `color:${row.qualifyingAhead > row.qualifyingBehind ? 'var(--green)' : row.qualifyingAhead < row.qualifyingBehind ? 'var(--redk)' : 'var(--ink2)'}`,
          text: `${row.qualifyingAhead}–${row.qualifyingBehind}`,
        }),
        el('td.num.opt-sm.muted', { text: `${points(row.myPoints)} · ${points(row.theirPoints)}` }),
      ))),
    ))),
  );
}

function seasonsCard(seasons) {
  if (!seasons.length) return null;
  return el('div.card', null,
    el('div.head', null, icon('calendar', 15), el('h2', { text: 'Season by season' })),
    el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
      el('thead', null, el('tr', null,
        el('th.num', { text: 'Year' }),
        el('th', { text: 'Team' }),
        el('th.num', { text: 'Pos' }),
        el('th.num', { text: 'Pts' }),
        el('th.num.opt-xs', { text: 'Starts' }),
        el('th.num.opt-sm', { text: 'Wins' }),
        el('th.num.opt-sm', { text: 'Pod' }),
      )),
      el('tbody', null, ...seasons.map((row) => el('tr', null,
        el('td.num', null, el('a', { href: `#/calendar/${row.year}`, text: String(row.year) })),
        el('td.muted', { text: row.constructors?.replaceAll(',', ' · ') ?? '—' }),
        el('td.num', {
          style: row.championshipPosition === 1 ? 'font-weight:800;color:var(--yellow)' : null,
          text: row.championshipPosition ? `P${row.championshipPosition}` : '—',
        }),
        el('td.num', { style: 'font-weight:700', text: points(row.points) }),
        el('td.num.muted.opt-xs', { text: String(row.starts) }),
        el('td.num.opt-sm', { text: String(row.wins) }),
        el('td.num.opt-sm', { text: String(row.podiums) }),
      ))),
    ))),
  );
}

function circuitsCard(circuits) {
  if (!circuits.length) return null;
  const best = circuits.slice(0, 12);
  return el('div.card', null,
    el('div.head', null, icon('circuit', 15), el('h2', { text: 'Strongest circuits' }),
      el('span.hint', { text: `${circuits.length} visited` })),
    el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
      el('thead', null, el('tr', null,
        el('th', { text: 'Circuit' }),
        el('th.num', { text: 'Starts' }),
        el('th.num', { text: 'Wins' }),
        el('th.num.opt-sm', { text: 'Podiums' }),
        el('th.num.opt-xs', { text: 'Best' }),
        el('th.num.opt-xs', { text: 'Avg' }),
      )),
      el('tbody', null, ...best.map((row) => el('tr', null,
        el('td', null, el('a', { href: `#/circuit/${row.circuitId}`, text: row.circuit }),
          el('div.muted', { style: 'font-size:11px', text: row.country })),
        el('td.num.muted', { text: String(row.starts) }),
        el('td.num', { style: row.wins ? 'font-weight:700;color:var(--yellow)' : null, text: String(row.wins) }),
        el('td.num.opt-sm', { text: String(row.podiums) }),
        el('td.num.opt-xs.muted', { text: row.best ? `P${row.best}` : '—' }),
        el('td.num.opt-xs.muted', { text: row.avgFinish ?? '—' }),
      ))),
    ))),
  );
}

/** One square per race across the whole career, grouped by season. */
function heatCard(results) {
  if (!results.length) return null;
  const bySeason = new Map();
  for (const row of results) {
    if (!bySeason.has(row.year)) bySeason.set(row.year, []);
    bySeason.get(row.year).push(row);
  }

  const rows = [...bySeason.entries()].reverse().map(([year, races]) => el('div', {
    style: 'display:flex;align-items:center;gap:10px;margin-bottom:4px',
  },
    el('a', { href: `#/calendar/${year}`, class: 'k', style: 'width:34px;flex-shrink:0', text: String(year) }),
    el('div.form', { style: 'flex-wrap:wrap' }, ...races.map((race) => el('i', {
      class: race.position === 1 ? 'win' : race.position <= 3 ? 'podium' : race.position ? 'points' : 'out',
      title: `${race.grandPrix} ${year}: ${race.positionText}`,
      text: race.position ? String(race.position) : '·',
    }))),
  ));

  return el('div.card', null,
    el('div.head', null, icon('chart', 15), el('h2', { text: 'Every race' }),
      el('span.hint', { text: `${results.length} starts at your line` })),
    el('div.body', null, ...rows),
  );
}

/** @param {{args:string[]}} ctx  route is #/driver/<id> */
export async function renderDriver({ args }) {
  const id = args[0];
  const data = await get('/api/driver', { id });
  const { driver, career, titles } = data;

  const age = driver.dateOfBirth
    ? Math.floor((Date.now() - Date.parse(driver.dateOfBirth)) / (365.25 * 864e5)) : null;

  return el('div', null,
    el('div.page-head', null,
      el('div', null,
        el('h1', null, driver.name,
          driver.number && el('span.muted', { style: 'font-weight:400;font-size:18px', text: ` #${driver.number}` })),
        el('div.sub', {
          text: [
            driver.nationality,
            career.firstYear ? `${career.firstYear}–${career.lastYear}` : null,
            driver.dateOfDeath ? `${date(driver.dateOfBirth)} – ${date(driver.dateOfDeath)}`
              : age ? `born ${date(driver.dateOfBirth)} (${age})` : null,
          ].filter(Boolean).join(' · '),
        }),
      ),
      el('span.spacer'),
      ...titles.map((year) => el('span.pill', {
        style: 'background:#3a2f0c;border-color:#6b5a18;color:var(--yellow)',
        title: `World champion in ${year}`,
        text: `★ ${year}`,
      })),
    ),

    el('div.card', null,
      el('div.head', null, icon('person', 15), el('h2', { text: 'Career at your spoiler line' }),
        el('span.hint', { text: driver.fullName })),
      statRow(career, titles),
    ),

    teammateCard(data.teammates),
    seasonsCard(data.seasons),
    el('div.grid-2', null, circuitsCard(data.circuits), heatCard(data.results)),
  );
}
