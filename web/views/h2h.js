// ============================================================================
// HEAD TO HEAD
//
// Any two drivers, from any era, compared only over the races they both actually
// contested. That restriction is the whole value: comparing Fangio's win rate with
// Verstappen's is a bar argument, but comparing Hamilton and Rosberg over the
// afternoons they shared is a measurement.
//
// Only races where BOTH were classified count toward the record. A comparison
// where one car retired measures reliability, not driving, and quietly folding
// those in is how head-to-head numbers get quoted misleadingly.
// ============================================================================

import { el, replace, points } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get } from '../lib/api.js';

/** A two-sided bar: green for the driver on the left, red for the one on the right. */
function versusBar(a, b) {
  const total = a + b || 1;
  return el('div.split', { style: 'height:9px' },
    el('i', { style: `width:${(a / total) * 100}%;background:var(--green)` }),
    el('i', { style: `width:${(b / total) * 100}%;background:var(--redk)` }),
  );
}

/** One compared statistic: value, label, value — with the winner highlighted. */
function compareRow(label, aValue, bValue, { higherWins = true, suffix = '' } = {}) {
  const aWins = aValue !== null && bValue !== null
    && (higherWins ? aValue > bValue : aValue < bValue);
  const bWins = aValue !== null && bValue !== null
    && (higherWins ? bValue > aValue : bValue < aValue);
  const cell = (value, won) => el('div', {
    style: `flex:1;font-family:var(--mono);font-size:19px;font-weight:${won ? 800 : 500};
            color:${won ? 'var(--ink)' : 'var(--ink3)'}`,
  }, value === null ? '—' : `${points(value)}${suffix}`);

  return el('div', { style: 'display:flex;align-items:center;padding:9px 0;border-bottom:1px solid #12161c' },
    el('div', { style: 'flex:1;text-align:right;padding-right:14px' }, cell(aValue, aWins)),
    el('div.k', { style: 'width:130px;text-align:center', text: label }),
    el('div', { style: 'flex:1;padding-left:14px' }, cell(bValue, bWins)),
  );
}

function resultCard(data, aName, bName) {
  if (!data.sharedRaces) {
    return el('div.notice', null, icon('warning', 19), el('div.msg', null,
      el('b', { text: 'No shared races at your spoiler line' }),
      `${aName} and ${bName} have not started a race together in anything you have watched. They may have raced each other later — move your line forward, or pick two drivers from the same era.`,
    ));
  }

  return el('div', null,
    el('div.card', null,
      el('div.head', null, icon('people', 15), el('h2', { text: 'Over the races they shared' }),
        el('span.hint', {
          text: `${data.sharedRaces} together${data.asTeammates ? `, ${data.asTeammates} as teammates` : ''} · ${data.firstYear}–${data.lastYear}`,
        })),
      el('div.body', null,
        el('div', { style: 'display:flex;align-items:baseline;margin-bottom:14px' },
          el('div', { style: 'flex:1;text-align:right;padding-right:14px;font-weight:800;font-size:16px', text: aName }),
          el('div.k', { style: 'width:130px;text-align:center', text: 'versus' }),
          el('div', { style: 'flex:1;padding-left:14px;font-weight:800;font-size:16px', text: bName }),
        ),

        el('div', { style: 'margin-bottom:14px' },
          el('div.k', { style: 'text-align:center;margin-bottom:6px', text: 'Finished ahead' }),
          versusBar(data.raceRecord.a, data.raceRecord.b),
          el('div', { style: 'display:flex;justify-content:space-between;margin-top:5px;font-family:var(--mono);font-weight:800' },
            el('span', { text: String(data.raceRecord.a) }),
            el('span.muted', { style: 'font-size:11px;font-weight:400',
              text: `${data.unclassified} race${data.unclassified === 1 ? '' : 's'} where one of them didn’t finish, excluded` }),
            el('span', { text: String(data.raceRecord.b) }),
          ),
        ),

        el('div', { style: 'margin-bottom:8px' },
          el('div.k', { style: 'text-align:center;margin-bottom:6px', text: 'Out-qualified' }),
          versusBar(data.qualifyingRecord.a, data.qualifyingRecord.b),
          el('div', { style: 'display:flex;justify-content:space-between;margin-top:5px;font-family:var(--mono);font-weight:800' },
            el('span', { text: String(data.qualifyingRecord.a) }),
            el('span', { text: String(data.qualifyingRecord.b) }),
          ),
        ),

        compareRow('Wins', data.a.wins, data.b.wins),
        compareRow('Podiums', data.a.podiums, data.b.podiums),
        compareRow('Points', data.a.points, data.b.points),
        compareRow('Best finish', data.a.best, data.b.best, { higherWins: false }),
        compareRow('Avg finish', data.a.avgFinish, data.b.avgFinish, { higherWins: false }),
      ),
    ),
    el('div.muted', { style: 'font-size:11.5px;padding:0 2px',
      text: 'Points are counted only from the shared races, under the scoring system in force at the time — so they compare like with like rather than one long career against one short one.' }),
  );
}

export async function renderH2H({ args }) {
  const host = el('div');
  const resultHost = el('div');
  const { drivers } = await get('/api/drivers', { });

  const pick = (selected) => el('select.pick', { style: 'min-width:190px' },
    el('option', { value: '', text: 'Choose a driver…' }),
    ...drivers.map((d) => el('option', {
      value: d.id, selected: d.id === selected,
      text: `${d.name} (${d.firstYear === d.lastYear ? d.firstYear : `${d.firstYear}–${d.lastYear}`})`,
    })),
  );

  const a = pick(args[0]);
  const b = pick(args[1]);

  async function compare() {
    if (!a.value || !b.value) {
      replace(resultHost, el('div.empty', { text: 'Pick two drivers to compare.' }));
      return;
    }
    if (a.value === b.value) {
      replace(resultHost, el('div.empty', { text: 'Pick two different drivers.' }));
      return;
    }
    replace(resultHost, el('div.empty', { text: 'Comparing…' }));
    // Keep the pair in the URL so a comparison can be bookmarked or shared.
    history.replaceState(null, '', `#/h2h/${a.value}/${b.value}`);
    try {
      const data = await get('/api/head-to-head', { a: a.value, b: b.value });
      const aName = drivers.find((d) => d.id === a.value)?.name ?? a.value;
      const bName = drivers.find((d) => d.id === b.value)?.name ?? b.value;
      replace(resultHost, resultCard(data, aName, bName));
    } catch (err) {
      replace(resultHost, el('div.empty', { text: err.message }));
    }
  }

  a.addEventListener('change', compare);
  b.addEventListener('change', compare);

  replace(host,
    el('div.page-head', null,
      el('div', null,
        el('h1', { text: 'Head to head' }),
        el('div.sub', { text: 'Two drivers, compared only over the races they both started.' }),
      ),
    ),
    el('div.card', null,
      el('div.body', null,
        el('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
          a, el('span.k', { text: 'versus' }), b,
        ),
      ),
    ),
    resultHost,
  );

  await compare();
  return host;
}
