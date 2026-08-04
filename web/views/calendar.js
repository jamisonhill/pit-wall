// ============================================================================
// CALENDAR
//
// The season laid out round by round, each one labelled with where it sits
// relative to your spoiler line. This is also the natural place to move that line:
// you have just watched a race, so you find it here and click it.
//
// The page is spoiler-free by construction — dates, names and circuits only. A
// round you haven't reached looks exactly like one you have, apart from the label.
// ============================================================================

import { el, replace, shortDate, date, untilText } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get, getOpen } from '../lib/api.js';
import { setLine, lineForRound, getLine } from '../lib/line.js';

const STATE_TEXT = {
  revealed: 'Watched',
  hidden: 'Run — hidden',
  upcoming: 'Upcoming',
};

function roundRow(round, year, line) {
  const isLinePosition = line?.mode === 'round' && line.year === year && line.round === round.round;
  const canSelect = round.state !== 'upcoming';

  const stateCell = round.state === 'revealed'
    ? el('span.pill.alive', { text: STATE_TEXT.revealed })
    : round.state === 'hidden'
      ? el('span.pill', { style: 'background:#2a1a12;border-color:#4a2c18;color:#f5c542', text: STATE_TEXT.hidden })
      : el('span.pill.out', { text: STATE_TEXT.upcoming });

  return el('tr', { style: isLinePosition ? 'background:#141b23' : null },
    el('td.pos.muted', { text: String(round.round) }),
    el('td', null,
      // Always linked, even for a round past your line: the race page itself
      // shows a padlock for each sealed session, and qualifying may already be
      // readable there.
      el('a', { href: `#/race/${year}/${round.round}`, style: 'font-weight:700', text: round.grandPrix }),
      el('div.muted', { style: 'font-size:11px', text: `${round.circuitName} · ${round.country}` }),
    ),
    el('td.num.muted.opt-xs', { text: shortDate(round.date) }),
    el('td', null, stateCell),
    el('td', { style: 'text-align:right' },
      isLinePosition
        ? el('span.k', { text: 'Your line' })
        : canSelect
          ? el('button.btn.small.ghost', {
            type: 'button',
            title: `Set your spoiler line to just after the ${round.grandPrix}`,
            onclick: () => setLine(lineForRound(round, year)),
          }, icon('lock', 13), 'Set line here')
          : el('span.muted', { style: 'font-size:11px', text: '—' }),
    ),
  );
}

/** The next real-world session, from the live jolpica calendar. Never gated. */
function nextSessionCard(next) {
  if (!next) return null;
  return el('div.card', null,
    el('div.head', null, icon('clock', 15), el('h2', { text: 'Next session' })),
    el('div.body', null,
      el('div', { style: 'display:flex;align-items:baseline;gap:12px;flex-wrap:wrap' },
        el('span', { style: 'font-weight:700;font-size:16px', text: next.label }),
        el('span.pill', { text: untilText(next.startUtc) }),
      ),
      el('div.muted', { style: 'margin-top:6px;font-size:12px',
        text: new Date(next.startUtc).toLocaleString(undefined, {
          weekday: 'long', day: 'numeric', month: 'long',
          hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        }) }),
      el('div.muted', { style: 'margin-top:10px;font-size:11.5px',
        text: 'Schedules aren’t results, so this is shown whatever your spoiler line says.' }),
    ),
  );
}

/** @param {{year:number}} ctx */
export async function renderCalendar({ year }) {
  const [calendar, { seasons }] = await Promise.all([
    get('/api/calendar', { year }),
    getOpen('/api/seasons'),
  ]);
  const line = getLine();
  const rounds = calendar.rounds ?? [];
  const watched = rounds.filter((r) => r.state === 'revealed').length;
  const hidden = rounds.filter((r) => r.state === 'hidden').length;

  const picker = el('select.pick', {
    onchange: (event) => { location.hash = `#/calendar/${event.target.value}`; },
  }, ...seasons.map((y) => el('option', { value: y, selected: y === year, text: String(y) })));

  return el('div', null,
    el('div.page-head', null,
      el('div', null,
        el('h1', { text: `${year} Season` }),
        el('div.sub', { text: `${rounds.length} rounds · ${watched} behind your line · ${hidden} run but hidden` }),
      ),
      el('span.spacer'),
      picker,
    ),

    nextSessionCard(calendar.next),

    el('div.card', null,
      el('div.head', null,
        icon('calendar', 15),
        el('h2', { text: 'Rounds' }),
        el('span.hint', { text: 'Click a round to move your spoiler line to it' }),
      ),
      el('div.body.flush', null,
        el('div.scroll-x', null, el('table.data', null,
          el('thead', null, el('tr', null,
            el('th.pos', { text: '#' }),
            el('th', { text: 'Grand Prix' }),
            el('th.num.opt-xs', { text: 'Date' }),
            el('th', { text: 'Status' }),
            el('th', { style: 'text-align:right', text: '' }),
          )),
          el('tbody', null, ...rounds.map((r) => roundRow(r, year, line))),
        )),
      ),
    ),
  );
}
