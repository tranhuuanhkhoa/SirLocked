import { session } from '../services/session.js';
import { escapeHtml, render } from '../utils/dom.js';

/**
 * The tab bar every admin page shares. The router mounts it in #admin-nav-root for each admin route, so a page never
 * includes it itself and its own re-renders cannot wipe it. A new tab goes here; `also` lists the routes that light it up.
 */
export const ADMIN_TABS = [
  { href: '#/admin', label: 'Tổng quan' },
  { href: '#/admin/cases', label: 'Vụ án', also: ['#/admin/import'] },
  { href: '#/admin/ai', label: 'Tạo vụ án AI' },
  { href: '#/admin/weekly', label: 'Hàng tuần' },
  { href: '#/admin/chests', label: 'Hòm & vật phẩm', also: ['#/admin/items'] },
  { href: '#/admin/cosmetics', label: 'Mỹ phẩm' },
  { href: '#/admin/players', label: 'Người chơi' },
  { href: '#/admin/economy', label: 'Kinh tế & chợ' },
  { href: '#/admin/audit', label: 'Nhật ký' },
];

/** Which tab a route belongs to. The longest match wins, so #/admin/cases does not also light up #/admin. */
export function activeAdminTab(hash) {
  const route = String(hash || '').split('?')[0];
  const matches = (href) => route === href || route.startsWith(`${href}/`);
  return ADMIN_TABS
    .filter((tab) => [tab.href, ...(tab.also ?? [])].some(matches))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

export function adminNavMarkup(hash) {
  const active = activeAdminTab(hash);
  return `
    <div class="admin-nav-scroll">
      ${ADMIN_TABS.map((tab) => {
    const current = tab === active;
    return `<a class="admin-nav-tab${current ? ' is-active' : ''}" href="${tab.href}"${current ? ' aria-current="page"' : ''}>${escapeHtml(tab.label)}</a>`;
  }).join('')}
    </div>`;
}

/** Shows the bar on admin routes and removes it everywhere else. Someone with AI access only reaches one admin page, so they get no bar. */
export function syncAdminNav(isAdminRoute, hash = window.location.hash) {
  const root = document.getElementById('admin-nav-root');
  if (!root) return;
  const show = Boolean(isAdminRoute) && session.isAdmin();
  root.hidden = !show;
  if (!show) {
    render(root, '');
    return;
  }
  render(root, adminNavMarkup(hash));
  // On a phone the bar scrolls sideways, so bring the current tab into view. Web fonts widen the tabs when they arrive, so once more after that.
  const current = root.querySelector('.admin-nav-tab.is-active');
  const scroller = root.querySelector('.admin-nav-scroll');
  if (!current || !scroller) return;
  const center = () => {
    scroller.scrollLeft = current.offsetLeft - (scroller.clientWidth - current.offsetWidth) / 2;
  };
  center();
  document.fonts?.ready.then(center);
}
