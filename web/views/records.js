// ============================================================================
// THE ALMANAC
//
// Career leaderboards, recomputed at the spoiler line. This is the page the gate
// was really built for: "most career wins" is the single statistic most likely to
// give away last Sunday's result, and it is the first thing a fan looks up.
//
// Set your line to the end of 2015 and Schumacher still leads the win count.
// That isn't a quirk — it is the point.
// ============================================================================

import { el, points } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get } from '../lib/api.js';

/** One leaderboard: rank, name, number. Every board shares this shape. */
function board(title, rows, { hrefBase = 'driver', suffix = '', note = null } = {}) {
  if (!rows?.length) return null;
  return el('div.card', null,
    el('div.head', null, el('h2', { text: title }), note && el('span.hint', { text: note })),
    el('div.body.flush', null, el('table.data', null,
      el('tbody', null, ...rows.map((row, i) => el('tr', null,
        el('td.pos.muted', { style: 'width:30px', text: String(i + 1) }),
        el('td', null,
          el('a', { href: `#/${hrefBase}/${row.id}`, style: i === 0 ? 'font-weight:700' : null,
            text: row.name }),
          el('div.muted', { style: 'font-size:10.5px',
            text: row.firstYear === row.lastYear ? String(row.firstYear) : `${row.firstYear}–${row.lastYear}` }),
        ),
        el('td.num', {
          style: `font-weight:${i === 0 ? 800 : 600};${i === 0 ? 'color:var(--yellow)' : ''}`,
          text: `${points(row.value)}${suffix}`,
        }),
      ))),
    )),
  );
}

function milestoneCards(m) {
  const card = (label, row, detail) => row && el('div.stat', null,
    el('div.k', { text: label }),
    el('div.v', { style: 'font-size:16px', text: row.name }),
    el('div.muted', { style: 'font-size:11px', text: detail(row) }),
  );

  return el('div.card', null,
    el('div.head', null, icon('list', 15), el('h2', { text: 'Oddities' })),
    el('div.stat-row', null,
      card('Youngest winner', m.youngestWinner, (r) => `${r.years} · ${r.grandPrix} ${r.year}`),
      card('Oldest winner', m.oldestWinner, (r) => `${r.years} · ${r.grandPrix} ${r.year}`),
      card('Won from furthest back', m.furthestClimb, (r) => `P${r.grid} · ${r.grandPrix} ${r.year}`),
      m.grandSlams?.[0] && el('div.stat', null,
        el('div.k', { text: 'Most grand slams' }),
        el('div.v', { style: 'font-size:16px', text: m.grandSlams[0].name }),
        el('div.muted', { style: 'font-size:11px',
          text: `${m.grandSlams[0].value} · pole, win, fastest lap, every lap led` }),
      ),
    ),
  );
}

export async function renderRecords() {
  const data = await get('/api/records');
  const d = data.drivers;
  const c = data.constructors;

  return el('div', null,
    el('div.page-head', null,
      el('div', null,
        el('h1', { text: 'Records' }),
        el('div.sub', { text: 'Every leaderboard counted only from races behind your spoiler line.' }),
      ),
    ),

    milestoneCards(data.milestones),

    el('div.card', null,
      el('div.head', null, icon('person', 15), el('h2', { text: 'Drivers' })),
      el('div.body', null, el('div.grid-2', null,
        board('World titles', d.titles),
        board('Race wins', d.wins),
        board('Podiums', d.podiums),
        board('Pole positions', d.poles),
        board('Championship points', d.points),
        board('Race starts', d.starts),
        board('Fastest laps', d.fastestLaps),
        board('Win rate', d.winRate, { suffix: '%', note: 'minimum 40 starts' }),
      )),
    ),

    el('div.card', null,
      el('div.head', null, icon('flag', 15), el('h2', { text: 'Constructors' })),
      el('div.body', null, el('div.grid-2', null,
        board('World titles', c.titles, { hrefBase: 'constructor' }),
        board('Race wins', c.wins, { hrefBase: 'constructor' }),
        board('Podiums', c.podiums, { hrefBase: 'constructor' }),
        board('Races entered', c.entries, { hrefBase: 'constructor' }),
      )),
    ),
  );
}
