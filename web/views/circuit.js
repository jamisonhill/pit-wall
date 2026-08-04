// ============================================================================
// A CIRCUIT
//
// The layout and the facts are always visible — Monaco is 3.337 km whether or not
// you have watched this year's race. Only the results are gated.
//
// The two numbers worth coming here for are the ones no results table shows: how
// often pole converts into a win, and how much the order actually changes. Between
// them they tell you whether a race here is a contest or a parade.
// ============================================================================

import { el, points, date } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get } from '../lib/api.js';
import { teamColour } from '../lib/teams.js';
import { trackOutline } from '../components/track.js';

/** Plain-English reading of the overtaking index, so the number means something. */
function overtakingLabel(index) {
  if (index === null) return '—';
  if (index < 2.0) return 'Procession';
  if (index < 2.35) return 'Track position matters';
  if (index < 2.6) return 'Racy';
  return 'Chaotic';
}

function characterCard(character, circuit) {
  const stat = (label, value, note) => el('div.stat', null,
    el('div.k', { text: label }),
    el('div.v', null, value, note && el('small', { text: note })),
  );

  return el('div.card', null,
    el('div.head', null, icon('circuit', 15), el('h2', { text: 'Character of the place' }),
      el('span.hint', { text: `${character.racesHeld} races at your line` })),
    el('div.stat-row', null,
      stat('Length', `${circuit.length}`, 'km'),
      stat('Turns', String(circuit.turns)),
      // F1DB stores CLOCKWISE / ANTI_CLOCKWISE.
      stat('Direction', circuit.direction === 'CLOCKWISE' ? 'CW' : 'CCW'),
      stat('Pole → win', character.poleToWin === null ? '—' : `${character.poleToWin}`, '%'),
      stat('Winner’s avg grid', character.winnerAvgGrid ?? '—'),
      stat('Overtaking', character.overtakingIndex ?? '—'),
      stat('Retirements', character.dnfRate === null ? '—' : `${character.dnfRate}`, '%'),
      stat('First held', character.firstYear ?? '—'),
    ),
    el('div.body', null,
      el('div', { style: 'font-size:13px;color:var(--ink2)' },
        el('b', { style: 'color:var(--ink)', text: overtakingLabel(character.overtakingIndex) }),
        ' — on average a finishing car moves ',
        el('b', { style: 'color:var(--ink)', text: String(character.overtakingIndex ?? '—') }),
        ' places relative to the others between the grid and the flag. ',
        character.poleToWin !== null
          ? `Pole has turned into a win ${character.poleToWin}% of the time here, from ${character.poleRaces} races.`
          : '',
      ),
      el('div.muted', { style: 'margin-top:10px;font-size:11.5px',
        text: 'Retirements are excluded from the overtaking figure — otherwise a track with high attrition looks like a track with a lot of passing, which is the opposite of the truth.' }),
    ),
  );
}

function lapRecordCard(record) {
  if (!record) return null;
  return el('div.card', null,
    el('div.head', null, icon('clock', 15), el('h2', { text: 'Fastest lap on record' }),
      el('span.hint', { text: 'at your spoiler line' })),
    el('div.body', null,
      el('div', { style: 'font-size:30px;font-weight:800;font-family:var(--mono);letter-spacing:-.02em',
        text: record.time }),
      el('div', { style: 'margin-top:6px' },
        el('b', { text: record.driver }),
        el('span.muted', { text: ` · ${record.constructor} · ${record.grandPrix} ${record.year}` }),
      ),
    ),
  );
}

function mastersCard(masters) {
  const list = (title, rows, hrefBase, idKey) => el('div', null,
    el('div.k', { style: 'margin-bottom:8px', text: title }),
    ...rows.map((row) => el('div', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0' },
      el('span.tnum', { style: 'width:20px;color:var(--yellow);font-weight:800', text: String(row.wins) }),
      el('a', { href: `#/${hrefBase}/${row[idKey]}`, text: row.name }),
    )),
  );

  if (!masters.drivers.length) return null;
  return el('div.card', null,
    el('div.head', null, icon('trophy', 15), el('h2', { text: 'Who owns the place' })),
    el('div.body', null, el('div.grid-2', null,
      list('Most wins — drivers', masters.drivers, 'driver', 'driverId'),
      list('Most wins — constructors', masters.constructors, 'constructor', 'constructorId'),
    )),
  );
}

function winnersCard(winners) {
  if (!winners.length) return null;
  return el('div.card', null,
    el('div.head', null, icon('list', 15), el('h2', { text: 'Every winner here' }),
      el('span.hint', { text: `${winners.length} races` })),
    el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
      el('thead', null, el('tr', null,
        el('th.num', { text: 'Year' }),
        el('th', { text: 'Winner' }),
        el('th.opt-sm', { text: 'Team' }),
        el('th.num.opt-xs', { text: 'From' }),
        el('th.num.opt-sm', { text: 'Time' }),
      )),
      el('tbody', null, ...winners.map((row) => el('tr', null,
        el('td.num', null, el('a', { href: `#/race/${row.year}/${row.round}`, text: String(row.year) })),
        el('td', null,
          el('span.teambar', { style: `background:${teamColour(row.constructorId)}` }),
          el('a', { href: `#/driver/${row.driverId}`, style: 'font-weight:600', text: row.driver }),
        ),
        el('td.opt-sm.muted', null,
          el('a', { href: `#/constructor/${row.constructorId}`, text: row.constructor })),
        el('td.num.muted.opt-xs', { text: row.fromGrid ? `P${row.fromGrid}` : '—' }),
        el('td.num.muted.opt-sm', { style: 'font-size:11.5px', text: row.time ?? '—' }),
      ))),
    ))),
  );
}

/** @param {{args:string[]}} ctx  route is #/circuit/<id> */
export async function renderCircuit({ args }) {
  const id = args[0];
  const data = await get('/api/circuit', { id });
  const { circuit, character } = data;

  return el('div', null,
    el('div.page-head', null,
      el('div', null,
        el('h1', { text: circuit.name }),
        el('div.sub', {
          text: [circuit.fullName, `${circuit.place}, ${circuit.country}`,
            circuit.type === 'STREET' ? 'street circuit' : circuit.type?.toLowerCase()]
            .filter(Boolean).join(' · '),
        }),
        circuit.previousNames && el('div.muted', { style: 'font-size:11.5px;margin-top:3px',
          text: `Previously: ${circuit.previousNames}` }),
      ),
    ),

    el('div.grid-2', null,
      el('div.card', null,
        el('div.head', null, icon('circuit', 15), el('h2', { text: 'Layout' })),
        el('div.body', null,
          trackOutline(circuit.id),
          el('div.muted', { style: 'text-align:center;font-size:11px;margin-top:8px',
            text: `${circuit.length} km · ${circuit.turns} turns · ${circuit.direction.replace('_', '-').toLowerCase()}` }),
        ),
      ),
      el('div', null,
        lapRecordCard(character.lapRecord),
        mastersCard(data.masters),
      ),
    ),

    characterCard(character, circuit),
    winnersCard(data.winners),
  );
}

/** The circuit index — every track you have seen a race at. */
export async function renderCircuits() {
  const { circuits } = await get('/api/circuits');
  return el('div', null,
    el('div.page-head', null,
      el('div', null, el('h1', { text: 'Circuits' }),
        el('div.sub', { text: `${circuits.length} tracks with a race behind your spoiler line.` })),
    ),
    el('div.card', null,
      el('div.body.flush', null, el('div.scroll-x', null, el('table.data', null,
        el('thead', null, el('tr', null,
          el('th', { text: 'Circuit' }),
          el('th.opt-xs', { text: 'Type' }),
          el('th.num.opt-sm', { text: 'Length' }),
          el('th.num.opt-sm', { text: 'Turns' }),
          el('th.num', { text: 'Races' }),
          el('th.num.opt-xs', { text: 'Used' }),
        )),
        el('tbody', null, ...circuits.map((row) => el('tr', null,
          el('td', null,
            el('a', { href: `#/circuit/${row.id}`, style: 'font-weight:600', text: row.name }),
            el('div.muted', { style: 'font-size:11px', text: `${row.place} · ${row.country}` }),
          ),
          el('td.opt-xs.muted', { style: 'font-size:11px',
            text: row.type === 'STREET' ? 'Street' : row.type === 'ROAD' ? 'Road' : 'Race' }),
          el('td.num.muted.opt-sm', { text: `${row.length} km` }),
          el('td.num.muted.opt-sm', { text: String(row.turns) }),
          el('td.num', { text: String(row.racesHeld) }),
          el('td.num.muted.opt-xs', {
            text: row.firstYear === row.lastYear ? String(row.firstYear) : `${row.firstYear}–${row.lastYear}`,
          }),
        ))),
      ))),
    ),
  );
}
