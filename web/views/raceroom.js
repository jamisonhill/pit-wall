// ============================================================================
// THE RACE ROOM — the door, not the room.
//
// Behind this page is the original Pit Wall telemetry dashboard: the live F1
// timing feed, the delay buffer, and replay of recorded sessions. It is the one
// part of this application the spoiler line cannot protect, because it shows a
// session as it unfolds rather than a database query it can filter.
//
// So it gets a door. Nothing loads until you say so, and the two ways in are
// labelled honestly: a recorded session is safe (it is a race you have chosen to
// sit down and watch), the live feed is not.
//
// Replaying a recording at real pace is, in fact, exactly what this whole
// application is for — watching a race days late without the result reaching you
// first. It was built for race day and turns out to be better suited to Tuesday.
// ============================================================================

import { el, replace, date } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getOpen } from '../lib/api.js';

function openRaceRoom() {
  // A full navigation, not a route change — the Race Room is a separate document
  // with its own WebSocket client, kept exactly as it was built.
  location.href = '/race-room/';
}

export async function renderRaceRoom() {
  const host = el('div');

  // Recorded sessions live on the server's disk; the list is not a spoiler (a file
  // named "British Grand Prix — Qualifying" tells you nothing about who was quick).
  let recordings = [];
  try {
    recordings = await getOpen('/api/recordings');
  } catch { /* the picker inside the Race Room will show them anyway */ }

  return replace(host,
    el('div.page-head', null,
      el('div', null,
        el('h1', { text: 'Race Room' }),
        el('div.sub', { text: 'Live timing and session replay — the one place the spoiler line cannot reach.' }),
      ),
    ),

    el('div.notice', null,
      icon('warning', 19),
      el('div.msg', null,
        el('b', { text: 'Everything past this point is ungated' }),
        'The Race Room streams a timing session as it happens: the tower, gaps, tyres, ' +
        'weather, race control and car telemetry. It cannot be filtered by your spoiler ' +
        'line, because it is showing a session unfolding rather than answering a query. ' +
        'Nothing connects until you choose one of the options below.',
      ),
    ),

    el('div.card', null,
      el('div.head', null, icon('clock', 15), el('h2', { text: 'Replay a recorded session' }),
        el('span.hint', { text: 'spoiler-safe — you choose what to watch' })),
      el('div.body', null,
        el('div', { style: 'font-size:13px;color:var(--ink2);margin-bottom:14px' },
          'Recorded sessions replay through the same pipeline at their original pace, so a ' +
          'race you missed on Sunday plays out on Tuesday exactly as it did live. Pause, ' +
          'time-shift, and jump around freely — the result reaches you only when you get to it.',
        ),
        recordings.length
          ? el('div.scroll-x', null, el('table.data', null,
            el('thead', null, el('tr', null,
              el('th', { text: 'Session' }),
              el('th.num.opt-xs', { text: 'Recorded' }),
              el('th.num.opt-sm', { text: 'Size' }),
            )),
            el('tbody', null, ...recordings.map((rec) => el('tr', null,
              el('td', { style: 'font-weight:600', text: rec.label }),
              el('td.num.muted.opt-xs', { text: date(rec.startedAt?.slice(0, 10)) }),
              el('td.num.muted.opt-sm', { text: `${Math.round(rec.sizeBytes / 1024)} KB` }),
            ))),
          ))
          : el('div.empty', { text: 'No sessions recorded yet. One is captured automatically whenever the live feed is running during a session.' }),
        el('div', { style: 'margin-top:14px' },
          el('button.btn', { type: 'button', onclick: openRaceRoom },
            icon('clock', 15), 'Open the Race Room'),
          el('span.muted', { style: 'margin-left:10px;font-size:11.5px',
            text: 'Pick a recording from the session picker at the bottom of the dashboard.' }),
        ),
      ),
    ),

    el('div.card', { style: 'border-color:#3a2023' },
      el('div.head', { style: 'background:#150e10' },
        icon('broadcast', 15), el('h2', { text: 'Connect to the live feed' }),
        el('span.hint', { text: 'not spoiler-safe' })),
      el('div.body', null,
        el('div', { style: 'font-size:13px;color:var(--ink2);margin-bottom:14px' },
          'During a race weekend the dashboard can connect to the official F1 timing ' +
          'stream. It opens in STANDBY and shows nothing until you press Start — but ' +
          'once you do, you are watching the session live, whatever your spoiler line says.',
        ),
        el('button.btn.primary', {
          type: 'button',
          onclick: () => {
            // A second, deliberate click. Same shape as the gate's "show me
            // everything": the dangerous option is never one button away.
            const confirmBox = document.getElementById('live-confirm');
            if (confirmBox) confirmBox.hidden = false;
          },
        }, icon('broadcast', 15), 'I understand — take me to the live feed'),
        el('div.confirm-live', { id: 'live-confirm', hidden: true, style: 'margin-top:12px' },
          el('p', { text: 'This opens the live timing dashboard. If a session is running right now, pressing Start there will show you the race as it happens.' }),
          el('button.btn.primary', { type: 'button', onclick: openRaceRoom },
            icon('broadcast', 15), 'Open the live dashboard'),
        ),
      ),
    ),
  );
}
