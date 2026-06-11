export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Renders html into the container and returns it. */
export function render(container, html) {
  container.innerHTML = html;
  return container;
}

/** querySelector shorthand scoped to a root. */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

/** Deterministic placeholder gradient for entities without real artwork. */
export function placeholderStyle(seedText) {
  let hash = 0;
  for (const ch of String(seedText)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const hue = hash % 360;
  const hue2 = (hue + 40) % 360;
  return `background: linear-gradient(135deg, hsl(${hue}, 35%, 18%), hsl(${hue2}, 45%, 30%));`;
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}
