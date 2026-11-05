/**
 * The site's addresses are plain paths, such as /admin/players?page=2. This moves between them without reloading the
 * site, follows links the same way, and moves links from before that change (#/market, in old emails, invites and
 * bookmarks) to the plain address of the same page.
 */
const ROUTE_CHANGED = 'sirlocked:route';
// Served by the backend or as files: following these has to leave the page.
const NOT_PAGES = /^\/(api|hubs|assets|css|Client|health|live)(\/|$)/;
const HAS_FILE_EXTENSION = /\.[a-z0-9]+$/i;

const here = () => `${window.location.pathname}${window.location.search}`;
let routed = here();

function announce() {
  // After the current task, as the browser's own hashchange was: whoever navigates finishes what it was doing first.
  setTimeout(() => window.dispatchEvent(new Event(ROUTE_CHANGED)), 0);
}

/** Runs `listener` each time the address moves to another page. */
export function onRouteChange(listener) {
  window.addEventListener(ROUTE_CHANGED, listener);
}

/** Goes to a page of this site. Going to the page already open does nothing. `replace` leaves no entry to go back to. */
export function navigate(to, { replace = false } = {}) {
  const target = new URL(to, window.location.origin);
  const next = `${target.pathname}${target.search}`;
  if (next === here()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
  routed = here();
  announce();
}

/** Changes the address without running the router, so whatever is on screen stays: a tab, the filters of a list. */
export function replaceAddress(to) {
  window.history.replaceState(window.history.state, '', to);
  routed = here();
}

function upgradeOldAddress() {
  const { hash, origin } = window.location;
  if (!hash.startsWith('#/')) return false;
  const target = new URL(hash.slice(1), origin);
  // #//elsewhere.example would be another site.
  if (target.origin !== origin) return false;
  replaceAddress(`${target.pathname}${target.search}`);
  return true;
}

function followLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest?.('a[href]');
  if (!anchor || anchor.hasAttribute('download')) return;
  const opensElsewhere = anchor.getAttribute('target');
  if (opensElsewhere && opensElsewhere !== '_self') return;
  const href = anchor.getAttribute('href');
  if (href.startsWith('#')) return;
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin || NOT_PAGES.test(url.pathname) || HAS_FILE_EXTENSION.test(url.pathname)) return;
  event.preventDefault();
  navigate(`${url.pathname}${url.search}`);
}

upgradeOldAddress();
window.addEventListener('hashchange', () => { if (upgradeOldAddress()) announce(); });
window.addEventListener('popstate', () => {
  if (here() === routed) return;
  routed = here();
  announce();
});
document.addEventListener('click', followLink);
