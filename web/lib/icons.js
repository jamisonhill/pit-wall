// Monoline icons drawn in the SF Symbols idiom: a 24×24 box, 1.6px rounded
// strokes, and currentColor so an icon always matches the text beside it.
// Hand-drawn rather than pulled from a library — there are only a dozen, and a
// font/CDN can't be embedded in a page this app serves itself.

const ICONS = {
  // A championship trophy.
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4Zm0 1.5H5.5v1A3.5 3.5 0 0 0 9 10M16 5.5h2.5v1A3.5 3.5 0 0 1 15 10M12 13v3m-3 4h6m-4.5 0-.5-4h6l-.5 4',
  // Calendar.
  calendar: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12ZM8 3v4m8-4v4M4 10h16',
  // Chequered flag on a pole.
  flag: 'M6 3v18M6 4.5h13l-2.5 4 2.5 4H6',
  // A person, for drivers.
  person: 'M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM4.5 20.5c0-3.6 3.36-6 7.5-6s7.5 2.4 7.5 6',
  // Two people, for a head-to-head comparison.
  people: 'M9 11a3.25 3.25 0 1 0 0-6.5A3.25 3.25 0 0 0 9 11Zm-6 9c0-3.2 2.9-5.25 6-5.25S15 16.8 15 20m1.5-15.3a3.25 3.25 0 0 1 0 6.1m2 3.6c2 .8 3.5 2.4 3.5 4.6',
  // A closed circuit seen from above.
  circuit: 'M7.5 19.5c-3 0-4.5-1.9-4.5-4s1.6-3.4 4-4.2c2.6-.9 4-1.4 4-3s-1.4-2.8-3.5-2.8m-.5 14h9c3 0 4.5-1.7 4.5-3.7s-1.4-3-3.5-3.6',
  // Padlock, shut — the spoiler line is holding.
  lock: 'M6.5 10.5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm1.5 0V7.5a4 4 0 0 1 8 0v3M12 14.5v3',
  // Padlock, open — you have chosen to see everything.
  unlock: 'M6.5 10.5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm1.5 0V7.5a4 4 0 0 1 7.7-1.5M12 14.5v3',
  // An eye with a stroke through it — hidden content.
  eyeSlash: 'M4 12s3.2-5.5 8-5.5c1.2 0 2.3.35 3.2.9M20 12s-3.2 5.5-8 5.5c-1.3 0-2.4-.4-3.4-1M4 4l16 16M10.5 10.4a2.2 2.2 0 0 0 3.1 3.1',
  // Clock, for countdowns and session times.
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  // Right chevron.
  chevronRight: 'm9.5 6 6 6-6 6',
  // Arrow stepping forward — advance the line one round.
  stepForward: 'M4 12h13m-4.5-4.5L17 12l-4.5 4.5M20 5v14',
  // Warning triangle.
  warning: 'M12 4.5 21 19.5H3L12 4.5Zm0 5v5m0 2.5v.5',
  // A broadcast antenna — live data.
  broadcast: 'M12 13.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM8.2 8.2a5.5 5.5 0 0 0 0 7.6m7.6-7.6a5.5 5.5 0 0 1 0 7.6M5.4 5.4a9.5 9.5 0 0 0 0 13.2m13.2-13.2a9.5 9.5 0 0 1 0 13.2',
  // Stacked list, for records and almanacs.
  list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  // Downward chart line, for progression.
  chart: 'M4 4v16h16M7.5 15l3.5-4.5 3 2.5L19 7',
};

/**
 * Build an icon element.
 * @param {keyof ICONS} name
 * @param {number} size  rendered px; the viewBox is always 24
 */
export function icon(name, size = 16) {
  const path = ICONS[name];
  if (!path) throw new Error(`no icon named "${name}"`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Decorative: the adjacent label is what a screen reader should read.
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}
