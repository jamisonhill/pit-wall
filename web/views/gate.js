// ============================================================================
// THE GATE
//
// The first thing anyone sees, and the only thing they see until they answer it.
// It is a full-screen takeover rather than a dismissible modal, and there is
// nothing rendered behind it — the app has fetched no results, because it has no
// line to fetch them at.
//
// Three ways to answer, in the order most people will want them:
//   1. pick the round you last watched (any season)
//   2. completed seasons only — nothing from this year at all
//   3. everything, up to the minute — behind a deliberate second confirmation
// ============================================================================

import { el, replace, shortDate } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getOpen, getCalendarAt } from '../lib/api.js';
import { lineForRound, lineForSeason, lineForLive, setLine, getLine } from '../lib/line.js';

// Any timestamp before the first world championship race seals the whole archive,
// which is exactly what the gate needs: a full calendar with nothing given away.
const SEALED = '1950-01-01T00:00:00Z';

/** Block until the archive has downloaded, showing progress meanwhile. */
async function waitForArchive(host) {
  for (;;) {
    let status;
    try {
      status = await getOpen('/api/archive');
    } catch {
      status = { state: 'error', error: 'Could not reach the server.' };
    }
    if (status.ready) { host.replaceChildren(); return; }

    const pct = Math.round((status.progress ?? 0) * 100);
    replace(host, el('div.notice', null,
      icon('warning', 19),
      el('div.msg', null,
        el('b', { text: status.state === 'error' ? 'The archive is unavailable' : 'Fetching the archive' }),
        status.state === 'error'
          ? `${status.error ?? 'Unknown error.'} The dashboard needs the F1DB archive before it can show anything.`
          : `Downloading every Formula 1 session since 1950 from F1DB${pct ? ` — ${pct}%` : ''}. This happens once; after that it just refreshes when a new race weekend is published.`,
      ),
    ));
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * One card in the gate. Either it expands to reveal controls (`onOpen`) or it is
 * a single decision taken on click (`onSelect`).
 */
function choice({ iconName, title, why, danger, onOpen, onSelect }) {
  const expand = el('div.expand');
  expand.hidden = true;

  const card = el('button.choice', { type: 'button', class: danger ? 'danger' : null },
    el('div.title', null, icon(iconName, 17), title),
    el('div.why', { text: why }),
    expand,
  );

  card.addEventListener('click', (event) => {
    if (onSelect) { onSelect(); return; }
    // Clicks on the controls inside an open card must not fold it back up.
    if (expand.contains(event.target)) return;
    const opening = expand.hidden;
    expand.hidden = !opening;
    card.classList.toggle('open', opening);
    if (opening) onOpen?.(expand);
  });
  return card;
}

/**
 * Render the gate into `root`. Resolves once a line has been set (or kept).
 * @param {HTMLElement} root
 * @param {{reason?:string}} [opts] set when the gate is reopened to move the line
 */
export async function renderGate(root, opts = {}) {
  const existing = getLine();

  const brand = el('div.brand', null,
    el('div.mark'),
    el('div', null, el('b', { text: 'Pit Wall' }), el('small', { text: 'Formula 1 Archive' })),
  );
  const heading = el('h1.lede', {
    text: opts.reason ? 'Move your spoiler line' : 'How far have you watched?',
  });
  const blurb = el('p.blurb', {
    text: opts.reason
      ?? 'This dashboard shows Formula 1 as it stood at a moment you choose. Nothing after that moment is loaded — not the standings, not the records, not a driver’s career total. Tell it where you are and it will hold the line.',
  });
  const statusHost = el('div');
  const choices = el('div');

  const sheet = el('div.sheet', null, brand, heading, blurb, statusHost, choices);
  replace(root, el('div.gate', null, sheet));

  await waitForArchive(statusHost);

  const { seasons } = await getOpen('/api/seasons');
  const thisYear = seasons[0];
  // "Completed seasons only" lands on the most recent season that has actually
  // finished — the previous year, unless the archive hasn't rolled over yet.
  const lastCompleteYear = seasons.find((y) => y < thisYear) ?? thisYear;

  replace(choices,
    choice({
      iconName: 'flag',
      title: 'I’ve watched up to a certain race',
      why: 'Pick the last Grand Prix you saw. Everything after it stays sealed.',
      onOpen: (host) => renderRoundPicker(host, existing?.year ?? thisYear, seasons),
    }),
    choice({
      iconName: 'calendar',
      title: 'Only completed seasons',
      why: `Nothing from ${thisYear} at all — the archive stops at the end of ${lastCompleteYear}.`,
      onSelect: () => setLine(lineForSeason(lastCompleteYear)),
    }),
    choice({
      iconName: 'unlock',
      title: 'I’m fully caught up — show me everything',
      why: 'Current standings, the latest result, live sessions. This cannot be un-seen.',
      danger: true,
      onOpen: (host) => replace(host, el('div.confirm-live', null,
        el('p', { text: `This shows the ${thisYear} championship as it stands right now, including the most recent race. If you are behind, fold this away and pick a round instead.` }),
        el('button.btn.primary', { type: 'button', onclick: () => setLine(lineForLive()) },
          icon('unlock', 15), 'Yes — show me everything'),
      )),
    }),
    // Reopening the gate to change a line should always offer a way back out.
    existing && el('div', { style: 'margin-top:18px' },
      el('button.btn.ghost', {
        type: 'button',
        onclick: () => window.dispatchEvent(new CustomEvent('spoilerline', { detail: existing })),
      }, icon('lock', 15), `Keep my current line — ${existing.label}`),
    ),
  );

  // The gate closes when a line is set; app.js listens for the same event.
  return new Promise((resolve) => {
    window.addEventListener('spoilerline', () => resolve(), { once: true });
  });
}

/** Season selector plus a scrollable list of that season's rounds. */
function renderRoundPicker(host, year, seasons) {
  const listHost = el('div.round-list');
  const picker = el('select.pick', {
    onchange: (event) => loadRounds(listHost, Number(event.target.value)),
  }, ...seasons.map((y) => el('option', { value: y, selected: y === year, text: String(y) })));

  replace(host,
    el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:10px' },
      el('span.k', { text: 'Season' }), picker,
    ),
    listHost,
  );
  loadRounds(listHost, year);
}

async function loadRounds(host, year) {
  replace(host, el('div.empty', { text: 'Loading the calendar…' }));
  let calendar;
  try {
    // Fetched fully sealed: names and dates only, no results, no winners.
    calendar = await getCalendarAt(year, SEALED);
  } catch (err) {
    replace(host, el('div.empty', { text: `Could not load ${year}: ${err.message}` }));
    return;
  }

  const rounds = calendar.rounds ?? [];
  if (!rounds.length) {
    replace(host, el('div.empty', { text: `No rounds recorded for ${year}.` }));
    return;
  }

  replace(host, ...rounds.map((round) => {
    // A race that hasn't been run can't be one you've watched. It stays listed —
    // a calendar is not a secret — but it isn't selectable.
    const notRunYet = round.state === 'upcoming';
    return el('button.round-opt', {
      type: 'button',
      disabled: notRunYet,
      title: notRunYet ? 'This race has not been run yet' : round.officialName,
      onclick: () => setLine(lineForRound(round, year)),
    },
      el('span.rd', { text: `R${round.round}` }),
      el('span.nm', { text: round.grandPrix }),
      el('span.dt', { text: notRunYet ? 'upcoming' : shortDate(round.date) }),
      !notRunYet && icon('chevronRight', 14),
    );
  }));
}
