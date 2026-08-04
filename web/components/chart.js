// Small canvas charts. Canvas rather than SVG because these redraw on resize and
// can carry twenty series; and hand-drawn rather than a charting library because
// the page is served straight off disk with no build step and no CDN.
//
// Everything here is drawn at devicePixelRatio so lines stay crisp on a Retina
// display, and re-drawn on resize so the same code works on a phone.

import { el } from '../lib/dom.js';

const AXIS = '#232a34';
const LABEL = '#6c7885';
const FONT = '10px ui-monospace, "SF Mono", Menlo, monospace';

/** Set the backing store to the element's real pixel size. Returns the 2D context. */
function fitCanvas(canvas, cssHeight) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 600;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  return { ctx, width, height: cssHeight };
}

/**
 * A multi-series line chart of championship points by round.
 *
 * @param {object} opts
 * @param {{round:number, grandPrix:string}[]} opts.rounds  x axis
 * @param {{abbreviation:string, colour:string, points:{round:number, points:number}[]}[]} opts.series
 * @param {number} [opts.height]
 * @returns {HTMLElement} a wrapper that redraws itself when the window resizes
 */
export function pointsChart({ rounds, series, height = 240 }) {
  const canvas = el('canvas');
  const wrap = el('div.chartwrap', null, canvas);

  function draw() {
    if (!canvas.clientWidth) return; // not laid out yet (e.g. inside a hidden tab)
    const { ctx, width } = fitCanvas(canvas, height);
    ctx.clearRect(0, 0, width, height);

    const padLeft = 34, padRight = 12, padTop = 10, padBottom = 22;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxRound = Math.max(...rounds.map((r) => r.round), 1);
    const minRound = Math.min(...rounds.map((r) => r.round), 1);
    const maxPoints = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.points)));

    // Round the top of the scale up to something a human would pick.
    const step = maxPoints > 400 ? 100 : maxPoints > 150 ? 50 : maxPoints > 60 ? 25 : 10;
    const top = Math.ceil(maxPoints / step) * step;

    const x = (round) => padLeft + (maxRound === minRound ? plotW / 2
      : ((round - minRound) / (maxRound - minRound)) * plotW);
    const y = (pts) => padTop + plotH - (pts / top) * plotH;

    // Horizontal gridlines and their labels.
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= top; v += step) {
      const gy = y(v);
      ctx.strokeStyle = AXIS;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, gy + 0.5);
      ctx.lineTo(width - padRight, gy + 0.5);
      ctx.stroke();
      ctx.fillStyle = LABEL;
      ctx.fillText(String(v), padLeft - 6, gy);
    }

    // Round numbers along the bottom, thinned out so they never collide.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const everyNth = Math.ceil(rounds.length / Math.max(1, Math.floor(plotW / 34)));
    rounds.forEach((round, i) => {
      if (i % everyNth !== 0 && i !== rounds.length - 1) return;
      ctx.fillStyle = LABEL;
      ctx.fillText(String(round.round), x(round.round), padTop + plotH + 6);
    });

    // The series themselves, drawn back to front so the leader sits on top.
    [...series].reverse().forEach((s) => {
      if (!s.points.length) return;
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const px = x(p.round), py = y(p.points);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // A dot on the final point anchors each line to its legend entry.
      const last = s.points.at(-1);
      ctx.fillStyle = s.colour;
      ctx.beginPath();
      ctx.arc(x(last.round), y(last.points), 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Redraw on resize (and once on the next frame, when layout has settled).
  const observer = new ResizeObserver(draw);
  observer.observe(wrap);
  requestAnimationFrame(draw);
  return wrap;
}

/**
 * Grid on the left, finish on the right, a line between. The single most honest
 * picture of a Grand Prix: everything that slopes is what the race actually did.
 *
 * SVG rather than canvas here — it is drawn once, carries text labels, and stays
 * sharp at any zoom.
 *
 * @param {{driver:string, colour:string, from:number|null, to:number|null,
 *          retired:boolean}[]} rows
 */
export function slopeChart(rows, { rowHeight = 19 } = {}) {
  const laid = rows.filter((r) => r.from);
  if (!laid.length) return el('div.empty', { text: 'No starting grid recorded for this race.' });

  const maxPos = Math.max(...laid.flatMap((r) => [r.from, r.to ?? r.from]));
  const height = maxPos * rowHeight + 34;
  const leftX = 74, rightX = 226;
  const y = (pos) => 22 + (pos - 0.5) * rowHeight;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 300 ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(height));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Starting grid position compared with finishing position');

  const add = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  };

  add('text', { x: leftX, y: 12, fill: '#6c7885', 'font-size': 9, 'letter-spacing': 1.6,
    'text-anchor': 'end', 'font-family': 'ui-monospace, Menlo, monospace' }, 'GRID');
  add('text', { x: rightX, y: 12, fill: '#6c7885', 'font-size': 9, 'letter-spacing': 1.6,
    'font-family': 'ui-monospace, Menlo, monospace' }, 'FINISH');

  for (const row of laid) {
    const y1 = y(row.from);
    // A retirement has nowhere to land, so its line stops short and fades — better
    // than pretending it finished last.
    const y2 = row.to ? y(row.to) : y1;
    add('path', {
      d: `M ${leftX + 4} ${y1} C ${leftX + 60} ${y1}, ${rightX - 60} ${y2}, ${rightX - 4} ${y2}`,
      fill: 'none',
      stroke: row.colour,
      'stroke-width': 1.8,
      'stroke-opacity': row.retired ? 0.22 : 0.9,
      'stroke-dasharray': row.retired ? '3 3' : null,
    });
    add('text', { x: leftX, y: y1 + 3.4, fill: '#aab4c0', 'font-size': 10.5,
      'text-anchor': 'end', 'font-family': 'ui-monospace, Menlo, monospace' },
      `${row.driver} ${row.from}`);
    add('text', { x: rightX, y: y2 + 3.4, fill: row.retired ? '#6c7885' : '#eef2f6',
      'font-size': 10.5, 'font-family': 'ui-monospace, Menlo, monospace' },
      row.retired ? `${row.driver} DNF` : `${row.to} ${row.driver}`);
  }

  return el('div.scroll-x', null, el('div', { style: 'min-width:300px' }, svg));
}

/** The colour key that goes with a pointsChart. */
export function chartLegend(series) {
  return el('div.legend', null, ...series.map((s) => el('span', null,
    el('i', { style: `background:${s.colour}` }),
    s.abbreviation,
  )));
}
