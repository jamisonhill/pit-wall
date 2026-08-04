// Team colours, so a constructor is recognisable at a glance in a table.
//
// Keyed by F1DB constructor id. Only current and recent teams are named; anything
// older falls back to a colour derived from its id, which is stable across reloads
// and keeps a 1961 results table legible without maintaining a list of every
// constructor that has ever entered a Grand Prix.

const KNOWN = {
  mercedes: '#00d7b6',
  ferrari: '#e8002d',
  'red-bull': '#3671c6',
  mclaren: '#ff8000',
  'aston-martin': '#229971',
  alpine: '#0093cc',
  williams: '#64c4ff',
  'rb': '#6692ff',
  'alphatauri': '#6692ff',
  'kick-sauber': '#52e252',
  sauber: '#52e252',
  'alfa-romeo': '#c92d4b',
  haas: '#b6babd',
  audi: '#bb0a30',
  cadillac: '#c8b273',
  renault: '#fff500',
  lotus: '#ffb800',
  'racing-point': '#f596c8',
  'force-india': '#f596c8',
  'toro-rosso': '#469bff',
  brawn: '#b8fd6e',
  jordan: '#ffa100',
  benetton: '#00a2f5',
  tyrrell: '#0c2f80',
  brabham: '#d3d3d3',
  matra: '#1c4bbd',
  cooper: '#0f6b3e',
  'bmw-sauber': '#293ea1',
  toyota: '#cc1e2b',
  honda: '#f7f7f7',
  jaguar: '#0b7a3e',
  minardi: '#000000',
};

/** A stable, reasonably distinct colour for anything not in the list above. */
function derived(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  // Mid lightness and moderate saturation keep every generated colour readable
  // against the near-black background without any of them shouting.
  return `hsl(${hash % 360} 55% 58%)`;
}

/** @param {string|null|undefined} constructorId */
export function teamColour(constructorId) {
  if (!constructorId) return '#6c7885';
  return KNOWN[constructorId] ?? derived(constructorId);
}
