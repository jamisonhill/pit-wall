// ============================================================================
// THE SHELL
//
// Builds the chrome once, then swaps the view inside it as the hash changes.
// Hash routing (#/standings, #/calendar/2019) rather than history routing keeps
// the server a plain static file server — no catch-all route, no rewrite rules.
//
// One rule governs the whole file: if there is no spoiler line, the gate is the
// only thing on screen and no view runs. Not "views render empty" — views do not
// run at all, so there is nothing to leak.
// ============================================================================

import { el, replace } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { getLine, hasLine, isLive, setLine, lineForRound, defaultYear } from './lib/line.js';
import { get, ApiError } from './lib/api.js';
import { renderGate } from './views/gate.js';
import { renderStandings } from './views/standings.js';
import { renderCalendar } from './views/calendar.js';
import { renderRace } from './views/race.js';
import { renderDriver } from './views/driver.js';
import { renderConstructor } from './views/constructor.js';
import { renderDrivers, renderConstructors } from './views/people.js';

// ---- Routing ----------------------------------------------------------------
// `nav: false` keeps detail pages out of the top bar — you reach them by clicking
// a name, not by browsing to them.

const ROUTES = [
  { path: 'standings', title: 'Championship', iconName: 'trophy', render: renderStandings },
  { path: 'calendar', title: 'Calendar', iconName: 'calendar', render: renderCalendar },
  { path: 'drivers', title: 'Drivers', iconName: 'person', render: renderDrivers },
  { path: 'constructors', title: 'Teams', iconName: 'flag', render: renderConstructors },
  { path: 'race', nav: false, render: renderRace },
  { path: 'driver', nav: false, render: renderDriver },
  { path: 'constructor', nav: false, render: renderConstructor },
];
const DEFAULT_ROUTE = 'standings';

/** '#/calendar/2019' → { path:'calendar', args:['2019'] } */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, ...args] = raw.split('/').filter(Boolean);
  return { path: path || DEFAULT_ROUTE, args };
}

// ---- Chrome -----------------------------------------------------------------

const nav = el('nav.main');
const lineBar = el('div.linebar');
const main = el('main.page');

function buildShell() {
  const header = el('header.topbar', null,
    el('div.row1', null,
      el('a.brand', { href: `#/${DEFAULT_ROUTE}` },
        el('div.mark'),
        el('div', null, el('b', { text: 'Pit Wall' }), el('small', { text: 'Formula 1 Archive' })),
      ),
      nav,
    ),
    lineBar,
  );

  const footer = el('footer.credits', null, el('div.inner', null,
    'Data from ',
    el('a', { href: 'https://github.com/f1db/f1db', target: '_blank', rel: 'noreferrer', text: 'F1DB' }),
    ', licensed ',
    el('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noreferrer', text: 'CC BY 4.0' }),
    '. Session schedules from the ',
    el('a', { href: 'https://api.jolpi.ca/', target: '_blank', rel: 'noreferrer', text: 'jolpica' }),
    ' calendar. Personal, non-commercial; not associated with Formula 1.',
  ));

  replace(document.body, el('div.shell', null, header, main, footer));
}

function buildNav(activePath) {
  replace(nav, ...ROUTES.filter((route) => route.nav !== false).map((route) => el('a', {
    href: `#/${route.path}`,
    class: route.path === activePath ? 'on' : null,
  }, icon(route.iconName, 15), route.title)));
}

// ---- The spoiler line bar ---------------------------------------------------
// Sits in the chrome on every page, because it is the site's primary control and
// you should never have to go looking for it to remember where you are.

async function buildLineBar() {
  const line = getLine();
  if (!line) { lineBar.replaceChildren(); return; }

  lineBar.className = isLive() ? 'linebar live' : 'linebar';
  const inner = el('div.inner', null,
    el('div.lock', null,
      icon(isLive() ? 'unlock' : 'lock', 16),
      el('span.k', { text: isLive() ? 'No spoiler line' : 'Spoiler line' }),
    ),
    el('span.where', { text: line.label }),
  );
  replace(lineBar, inner);

  // How many run-but-unseen rounds sit past the line, plus a one-round step
  // forward. Both need the calendar, so they arrive a moment after the bar itself.
  if (line.mode === 'round') {
    try {
      const calendar = await get('/api/calendar', { year: line.year });
      const hidden = calendar.hiddenRounds ?? 0;
      const nextRound = (calendar.rounds ?? []).find((r) => r.round === line.round + 1);

      if (hidden > 0) {
        inner.appendChild(el('span.hidden-count', {
          text: `${hidden} newer round${hidden === 1 ? '' : 's'} hidden`,
        }));
      }
      inner.appendChild(el('span.spacer'));
      if (nextRound && nextRound.state === 'hidden') {
        inner.appendChild(el('button.btn.small', {
          type: 'button',
          title: `Reveal ${nextRound.grandPrix}`,
          onclick: () => setLine(lineForRound(nextRound, line.year)),
        }, icon('stepForward', 14), `Advance to R${nextRound.round}`));
      }
    } catch { /* the bar is still useful without the counts */ }
  } else {
    inner.appendChild(el('span.spacer'));
  }

  inner.appendChild(el('button.btn.small.ghost', {
    type: 'button',
    onclick: () => openGate('Move your line to a different race, season, or all the way to the present.'),
  }, icon('eyeSlash', 14), 'Change'));
}

// ---- Rendering --------------------------------------------------------------

let renderToken = 0; // guards against a slow view painting over a newer one

async function renderRoute() {
  const { path, args } = parseHash();
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  buildNav(route.path);
  window.scrollTo(0, 0);

  const token = ++renderToken;
  replace(main, el('div.empty', { text: 'Loading…' }));
  try {
    const view = await route.render({ args, year: Number(args[0]) || defaultYear() });
    if (token === renderToken) replace(main, view);
  } catch (err) {
    if (token !== renderToken) return;
    replace(main, renderError(err));
  }
}

function renderError(err) {
  // A 400 here means a request went out without a usable line — which should be
  // impossible, so say so plainly rather than dressing it up as a normal error.
  const noArchive = err instanceof ApiError && err.status === 503;
  return el('div.notice', null,
    icon('warning', 19),
    el('div.msg', null,
      el('b', { text: noArchive ? 'The archive is not ready' : 'Could not load this page' }),
      err.message,
      noArchive && el('div', { style: 'margin-top:10px' },
        el('button.btn.small', { type: 'button', onclick: () => renderRoute() }, 'Try again')),
    ),
  );
}

// ---- The gate ---------------------------------------------------------------

let gateOpen = false;

async function openGate(reason) {
  if (gateOpen) return;
  gateOpen = true;
  const host = el('div');
  document.body.appendChild(host);
  try {
    await renderGate(host, reason ? { reason } : {});
  } finally {
    host.remove();
    gateOpen = false;
  }
  await buildLineBar();
  await renderRoute();
}

// ---- Boot -------------------------------------------------------------------

buildShell();
window.addEventListener('hashchange', renderRoute);
// Moving the line invalidates every number on screen, so redraw both.
window.addEventListener('spoilerline', async () => {
  if (gateOpen) return;      // openGate does this itself once the gate closes
  await buildLineBar();
  await renderRoute();
});

if (!hasLine()) {
  openGate();
} else {
  buildLineBar();
  renderRoute();
}
