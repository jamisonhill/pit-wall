// Index pages: every driver and every constructor you have seen race.
//
// The list itself respects the line. A driver who has only started races past
// your line simply isn't here yet — otherwise the index would quietly announce
// a debut you haven't watched.

import { el, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get, getOpen } from '../lib/api.js';
import { teamColour } from '../lib/teams.js';
import { defaultYear } from '../lib/line.js';

/** Season filter shared by both index pages. 'all' means every season on record. */
function seasonFilter(seasons, selected, onChange) {
  return el('select.pick', { onchange: (e) => onChange(e.target.value) },
    el('option', { value: 'all', selected: selected === 'all', text: 'All time' }),
    ...seasons.map((y) => el('option', { value: y, selected: String(y) === String(selected), text: String(y) })),
  );
}

export async function renderDrivers({ args }) {
  const initialYear = args[0] ?? String(defaultYear());
  const { seasons } = await getOpen('/api/seasons');
  const host = el('div');
  const listHost = el('div.card');

  const search = el('input.pick', {
    type: 'search', placeholder: 'Search drivers…', style: 'min-width:180px',
  });

  async function load(year, query) {
    replace(listHost, el('div.empty', { text: 'Loading…' }));
    const { drivers } = await get('/api/drivers', {
      year: year === 'all' ? null : year,
      q: query || null,
    });
    replace(listHost,
      el('div.head', null, icon('person', 15), el('h2', { text: 'Drivers' }),
        el('span.hint', { text: `${drivers.length} with a start at your line` })),
      el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
        el('thead', null, el('tr', null,
          el('th', { text: 'Driver' }),
          el('th.opt-xs', { text: 'Nat' }),
          el('th.num', { text: 'Seasons' }),
          el('th.num', { text: 'Starts' }),
          el('th.num', { text: 'Wins' }),
        )),
        el('tbody', null, ...drivers.map((row) => el('tr', null,
          el('td', null,
            el('a', { href: `#/driver/${row.id}` },
              el('span.drv-code', { text: row.abbreviation }),
              el('span.drv-name', { text: ` ${row.name}` })),
          ),
          el('td.opt-xs.muted', { text: row.nationality }),
          el('td.num.muted', {
            text: row.firstYear === row.lastYear ? String(row.firstYear) : `${row.firstYear}–${row.lastYear}`,
          }),
          el('td.num', { text: String(row.starts) }),
          el('td.num', { style: row.wins ? 'font-weight:700;color:var(--yellow)' : null, text: String(row.wins) }),
        ))),
      ))),
    );
  }

  let year = initialYear;
  // Wait a beat after each keystroke so a search doesn't fire a request per letter.
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(year, search.value.trim()), 220);
  });

  replace(host,
    el('div.page-head', null,
      el('div', null, el('h1', { text: 'Drivers' }),
        el('div.sub', { text: 'Careers recomputed at your spoiler line.' })),
      el('span.spacer'),
      search,
      seasonFilter(seasons, year, (next) => { year = next; load(year, search.value.trim()); }),
    ),
    listHost,
  );
  await load(year, '');
  return host;
}

export async function renderConstructors({ args }) {
  const initialYear = args[0] ?? String(defaultYear());
  const { seasons } = await getOpen('/api/seasons');
  const host = el('div');
  const listHost = el('div.card');

  async function load(year) {
    replace(listHost, el('div.empty', { text: 'Loading…' }));
    const { constructors } = await get('/api/constructors', { year: year === 'all' ? null : year });
    replace(listHost,
      el('div.head', null, icon('flag', 15), el('h2', { text: 'Constructors' }),
        el('span.hint', { text: `${constructors.length} teams` })),
      el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
        el('thead', null, el('tr', null,
          el('th', { text: 'Constructor' }),
          el('th.opt-xs', { text: 'Nat' }),
          el('th.num', { text: 'Seasons' }),
          el('th.num', { text: 'Races' }),
          el('th.num', { text: 'Wins' }),
        )),
        el('tbody', null, ...constructors.map((row) => el('tr', null,
          el('td', null,
            el('span.teambar', { style: `background:${teamColour(row.id)}` }),
            el('a', { href: `#/constructor/${row.id}`, style: 'font-weight:600', text: row.name }),
          ),
          el('td.opt-xs.muted', { text: row.nationality }),
          el('td.num.muted', {
            text: row.firstYear === row.lastYear ? String(row.firstYear) : `${row.firstYear}–${row.lastYear}`,
          }),
          el('td.num', { text: String(row.entries) }),
          el('td.num', { style: row.wins ? 'font-weight:700;color:var(--yellow)' : null, text: String(row.wins) }),
        ))),
      ))),
    );
  }

  let year = initialYear;
  replace(host,
    el('div.page-head', null,
      el('div', null, el('h1', { text: 'Constructors' }),
        el('div.sub', { text: 'Totals recomputed at your spoiler line.' })),
      el('span.spacer'),
      seasonFilter(seasons, year, (next) => { year = next; load(year); }),
    ),
    listHost,
  );
  await load(year);
  return host;
}
