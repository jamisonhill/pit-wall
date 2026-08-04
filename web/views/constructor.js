// ============================================================================
// A CONSTRUCTOR
//
// Same shape as the driver page and the same rule: every total is recomputed at
// the spoiler line rather than read from a stored career figure.
//
// One thing that only makes sense for a team: the one-two count. Locking out the
// front row is a fluke; locking out the podium's top two steps means the car was
// simply the best thing on the grid that day.
// ============================================================================

import { el, points } from '../lib/dom.js';
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
    stat('Races entered', String(career.entries)),
    stat('Wins', String(career.wins), `${career.winRate}%`),
    stat('One-twos', String(career.oneTwos)),
    stat('Podiums', String(career.podiums)),
    stat('Poles', String(career.poles)),
    stat('Fastest laps', String(career.fastestLaps)),
    stat('Points', points(career.points)),
  );
}

function seasonsCard(seasons) {
  if (!seasons.length) return null;
  return el('div.card', null,
    el('div.head', null, icon('calendar', 15), el('h2', { text: 'Season by season' })),
    el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
      el('thead', null, el('tr', null,
        el('th.num', { text: 'Year' }),
        el('th.opt-sm', { text: 'Engine' }),
        el('th.num', { text: 'Pos' }),
        el('th.num', { text: 'Pts' }),
        el('th.num.opt-xs', { text: 'Rounds' }),
        el('th.num.opt-sm', { text: 'Wins' }),
        el('th.num.opt-sm', { text: 'Pod' }),
      )),
      el('tbody', null, ...seasons.map((row) => el('tr', null,
        el('td.num', null, el('a', { href: `#/calendar/${row.year}`, text: String(row.year) })),
        el('td.muted.opt-sm', { text: row.engines?.replaceAll(',', ' · ') ?? '—' }),
        el('td.num', {
          style: row.championshipPosition === 1 ? 'font-weight:800;color:var(--yellow)' : null,
          text: row.championshipPosition ? `P${row.championshipPosition}` : '—',
        }),
        el('td.num', { style: 'font-weight:700', text: points(row.points) }),
        el('td.num.muted.opt-xs', { text: String(row.rounds) }),
        el('td.num.opt-sm', { text: String(row.wins) }),
        el('td.num.opt-sm', { text: String(row.podiums) }),
      ))),
    ))),
  );
}

function driversCard(drivers) {
  if (!drivers.length) return null;
  return el('div.card', null,
    el('div.head', null, icon('people', 15), el('h2', { text: 'Who has driven for them' }),
      el('span.hint', { text: `${drivers.length} drivers` })),
    el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
      el('thead', null, el('tr', null,
        el('th', { text: 'Driver' }),
        el('th.num.opt-xs', { text: 'Years' }),
        el('th.num', { text: 'Starts' }),
        el('th.num', { text: 'Wins' }),
        el('th.num.opt-sm', { text: 'Podiums' }),
        el('th.num.opt-sm', { text: 'Points' }),
      )),
      el('tbody', null, ...drivers.map((row) => el('tr', null,
        el('td', null, el('a', { href: `#/driver/${row.driverId}`, style: 'font-weight:600', text: row.name })),
        el('td.num.muted.opt-xs', {
          text: row.firstYear === row.lastYear ? String(row.firstYear) : `${row.firstYear}–${row.lastYear}`,
        }),
        el('td.num.muted', { text: String(row.starts) }),
        el('td.num', { style: row.wins ? 'font-weight:700;color:var(--yellow)' : null, text: String(row.wins) }),
        el('td.num.opt-sm', { text: String(row.podiums) }),
        el('td.num.opt-sm', { text: points(row.points) }),
      ))),
    ))),
  );
}

/** @param {{args:string[]}} ctx  route is #/constructor/<id> */
export async function renderConstructor({ args }) {
  const id = args[0];
  const data = await get('/api/constructor', { id });
  const { constructor, career, titles } = data;

  return el('div', null,
    el('div.page-head', null,
      el('div', { style: 'display:flex;align-items:center;gap:12px' },
        el('span', { style: `display:inline-block;width:6px;height:34px;border-radius:3px;background:${teamColour(constructor.id)}` }),
        el('div', null,
          el('h1', { text: constructor.name }),
          el('div.sub', {
            text: [constructor.country,
              career.firstYear ? `${career.firstYear}–${career.lastYear}` : null].filter(Boolean).join(' · '),
          }),
        ),
      ),
      el('span.spacer'),
      ...titles.slice(-8).map((year) => el('span.pill', {
        style: 'background:#3a2f0c;border-color:#6b5a18;color:var(--yellow)',
        title: `Constructors' champion in ${year}`,
        text: `★ ${year}`,
      })),
      titles.length > 8 && el('span.pill', { text: `+${titles.length - 8} more` }),
    ),

    el('div.card', null,
      el('div.head', null, icon('flag', 15), el('h2', { text: 'At your spoiler line' }),
        el('span.hint', { text: constructor.fullName })),
      statRow(career, titles),
    ),

    seasonsCard(data.seasons),
    driversCard(data.drivers),
  );
}
