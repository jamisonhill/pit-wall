// A handful of DOM helpers so views can be written as plain functions returning
// elements, with no template strings and therefore no way to inject markup by
// accident. There is no framework here on purpose: the pages are small, the data
// arrives already shaped by the API, and a build step would be one more thing
// standing between an edit and seeing it in the browser.

/**
 * Create an element.
 *
 * @param {string} tag        'div', or a shorthand like 'div.card.wide' / 'td.num'
 * @param {object|null} attrs attributes; `class`, `text`, `html`, and on* handlers
 *                            are all understood
 * @param {...(Node|string|null|undefined|Array)} children
 *
 * @example el('td.num', null, '25')
 * @example el('button.btn', { onclick: save }, icon('lock'), 'Set line')
 */
export function el(tag, attrs = null, ...children) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = [node.className, value].filter(Boolean).join(' ');
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;      // only ever used with our own SVG
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }

  append(node, children);
  return node;
}

/** Append children, flattening arrays and skipping null/undefined/false. */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Replace everything inside `parent` with `children`. */
export function replace(parent, ...children) {
  parent.replaceChildren();
  return append(parent, children);
}

// ---- Formatting -------------------------------------------------------------

/** Championship points: whole where whole, one decimal for the half-point years. */
export function points(value) {
  if (value === null || value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** A signed gap, e.g. '−25' (never '-0'). */
export function gap(value) {
  if (!value) return '—';
  return `−${points(value)}`;
}

/** '5 Jul 2026' — unambiguous, and short enough for a table cell. */
export function date(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00Z`); // midday avoids timezone slipping the day
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** '5 Jul' — for a calendar list where the year is already in the heading. */
export function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** 'in 2 days' / 'in 4 hours' / 'in 12 minutes', for the next-session countdown. */
export function untilText(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `in ${Math.round(hours / 24)} days`;
}
