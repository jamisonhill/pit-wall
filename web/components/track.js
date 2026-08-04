// Track outlines, drawn from GeoJSON.
//
// Each circuit is a LineString of GPS points. Turning that into an SVG path is
// mostly projection: longitude degrees get narrower as you move away from the
// equator, so a naive plot squashes Zandvoort and stretches Melbourne. Scaling
// longitude by cos(latitude) — an equirectangular projection — keeps the shape
// honest at the size of a race track.
//
// Outlines: github.com/bacinger/f1-circuits (MIT), © 2019–2025 Tomislav Bacinger.

import { el } from '../lib/dom.js';
import { CIRCUIT_GEOJSON_ID } from '../data/circuit-map.js';

let geojsonPromise = null;

/** Load the outline collection once and share it across every circuit page. */
function loadCircuits() {
  if (!geojsonPromise) {
    geojsonPromise = fetch('/data/f1-circuits.geojson')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null); // a missing outline is a cosmetic loss, never an error
  }
  return geojsonPromise;
}

/**
 * The SVG path for one circuit, fitted to a 100×100 box with a small margin.
 * @returns {{d:string, start:[number,number]}|null}
 */
function pathFor(feature) {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 3) return null;

  const meanLat = coords.reduce((sum, [, lat]) => sum + lat, 0) / coords.length;
  const kx = Math.cos((meanLat * Math.PI) / 180); // longitude shrinks toward the poles
  const pts = coords.map(([lon, lat]) => [lon * kx, lat]);

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = 88 / span;
  // Centre whichever axis is the shorter one, and flip Y — SVG counts downwards.
  const offX = 6 + (88 - (maxX - minX) * scale) / 2;
  const offY = 6 + (88 - (maxY - minY) * scale) / 2;
  const project = ([x, y]) => [
    offX + (x - minX) * scale,
    100 - (offY + (y - minY) * scale),
  ];

  const projected = pts.map(project);
  const d = projected
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ') + ' Z';
  return { d, start: projected[0] };
}

/**
 * Render a circuit's outline, or a quiet placeholder when we have no geometry for
 * it — plenty of circuits in the archive last hosted a race in 1957.
 *
 * @param {string} circuitId  an F1DB circuit id
 * @param {{size?:number, colour?:string}} [opts]
 */
export function trackOutline(circuitId, { size = 260, colour = 'var(--redk)' } = {}) {
  const host = el('div', { style: `width:100%;max-width:${size}px;margin:0 auto` });

  loadCircuits().then((collection) => {
    const featureId = CIRCUIT_GEOJSON_ID[circuitId];
    const feature = featureId && collection?.features?.find((f) => f.properties?.id === featureId);
    const path = feature && pathFor(feature);

    if (!path) {
      host.appendChild(el('div.empty', { style: 'font-size:12px',
        text: 'No track outline on file for this circuit.' }));
      return;
    }

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('width', '100%');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Outline of ${feature.properties.Name}`);

    // Two strokes: a wide dark one for the tarmac, a thin bright one on top for
    // the racing surface. Reads as a track rather than as a squiggle.
    for (const [width, stroke, opacity] of [[5.5, '#232a34', 1], [2, colour, 1]]) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', path.d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', width);
      p.setAttribute('stroke-opacity', opacity);
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(p);
    }

    // A tick across the start/finish line.
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', path.start[0]);
    dot.setAttribute('cy', path.start[1]);
    dot.setAttribute('r', 2.6);
    dot.setAttribute('fill', '#eef2f6');
    svg.appendChild(dot);

    host.replaceChildren(svg);
  });

  return host;
}
