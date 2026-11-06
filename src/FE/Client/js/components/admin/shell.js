import { adminApi } from '../../api/adminApi.js';
import { authApi } from '../../api/authApi.js';
import { navigate } from '../../services/navigation.js';
import { languageSwitchMarkup, tr } from '../../services/i18n.js';
import { session } from '../../services/session.js';
import { escapeHtml, initials, render } from '../../utils/dom.js';
import { icon } from './icons.js';

/**
 * Khung admin "Hồ sơ giấy": sidebar ở #admin-nav-root và thanh trên ở #nav-root.
 * Router gọi syncAdminArea(route) trên mọi route; trang không tự vẽ khung, nên trang vẽ lại #app thoải mái.
 * Một mục mới thêm vào ADMIN_TABS; `also` liệt kê các route làm sáng mục đó.
 */
export const ADMIN_TABS = [
  { href: '/admin', label: 'Tổng quan', icon: 'grid' },
  { href: '/admin/cases', label: 'Vụ án', icon: 'folder', also: ['/admin/import'], count: 'cases' },
  { href: '/admin/ai', label: 'Tạo vụ án AI', icon: 'sparkle' },
  { href: '/admin/weekly', label: 'Hàng tuần', icon: 'calendar' },
  { href: '/admin/chests', label: 'Hòm & vật phẩm', icon: 'chest', also: ['/admin/items'] },
  { href: '/admin/cosmetics', label: 'Mỹ phẩm', icon: 'gem' },
  { href: '/admin/players', label: 'Người chơi', icon: 'users', count: 'users' },
  { href: '/admin/economy', label: 'Kinh tế & chợ', icon: 'coins' },
  { href: '/admin/audit', label: 'Nhật ký', icon: 'clock' },
];

/** Mục nào sáng cho một địa chỉ. Khớp dài nhất thắng, để /admin/cases không làm sáng cả /admin. */
export function activeAdminTab(address) {
  const route = String(address || '').split('?')[0];
  const matches = (href) => route === href || route.startsWith(`${href}/`);
  return ADMIN_TABS
    .filter((tab) => [tab.href, ...(tab.also ?? [])].some(matches))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

/* ---------- số đếm trên sidebar (vụ án, người dùng), lấy từ /api/admin/dashboard ---------- */

const COUNT_TTL_MS = 60_000;
let counts = { at: 0, cases: null, users: null, pending: null };

/** Trang Tổng quan đã có số liệu thì đưa vào đây, khỏi gọi lại. */
export function shareAdminCounts(stats) {
  if (!stats) return;
  counts = { at: Date.now(), cases: stats.totalCases ?? null, users: stats.totalUsers ?? null, pending: null };
  paintCounts();
}

function paintCounts() {
  document.querySelectorAll('#admin-nav-root .admin-nav-tab[data-count-key]').forEach((link) => {
    const value = counts[link.dataset.countKey];
    if (value === null || value === undefined) link.removeAttribute('data-count');
    else link.setAttribute('data-count', Number(value).toLocaleString('vi-VN'));
  });
}

function refreshCounts() {
  if (Date.now() - counts.at < COUNT_TTL_MS || counts.pending) {
    paintCounts();
    return;
  }
  counts.pending = adminApi.dashboard()
    .then((stats) => shareAdminCounts(stats))
    .catch(() => { counts = { ...counts, at: Date.now(), pending: null }; })
    .finally(() => { counts.pending = null; });
}

/* ---------- sidebar ---------- */

export function adminNavMarkup(address) {
  const active = activeAdminTab(address);
  const user = session.user() || {};
  const name = user.fullName || tr('Administrator', 'Quản trị viên');
  return `
    <div class="adm-side">
      <div class="adm-side-head">
        <a class="adm-brand" href="/admin" aria-label="Sir Locked, bảng quản trị">
          ${icon('compass', 34)}
          <span class="adm-brand-text" aria-hidden="true">
            <span class="adm-brand-name">SIR LOCKED</span>
            <span class="adm-brand-sub">BẢNG QUẢN TRỊ</span>
          </span>
        </a>
        <button type="button" class="adm-menu-toggle" aria-expanded="false" aria-controls="adm-side-body" data-adm-menu>
          ${icon('menu', 18)}<span class="adm-menu-current">${escapeHtml(active?.label ?? 'Menu')}</span>
        </button>
      </div>
      <div class="adm-side-body" id="adm-side-body">
        <nav class="adm-nav" aria-label="Quản trị">
          ${ADMIN_TABS.map((tab) => {
    const current = tab === active;
    return `<a class="admin-nav-tab${current ? ' is-active' : ''}" href="${tab.href}"${current ? ' aria-current="page"' : ''}${tab.count ? ` data-count-key="${tab.count}"` : ''}>${icon(tab.icon, 20)}<span>${escapeHtml(tab.label)}</span></a>`;
  }).join('')}
        </nav>
        <div class="adm-side-foot">
          <a class="adm-back" href="/menu">${icon('chevronLeft', 20)}<span>${tr('Back to the game', 'Về trang game')}</span></a>
          <div class="adm-me">
            <span class="adm-me-avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>
            <span class="adm-me-text">
              <span class="adm-me-name">${escapeHtml(name)}</span>
              <span class="adm-me-role">${tr('Administrator', 'Quản trị viên')}</span>
            </span>
            <button type="button" class="adm-icon-btn" id="nav-logout" aria-label="${tr('Log out', 'Đăng xuất')}" title="${tr('Log out', 'Đăng xuất')}">${icon('logout', 20)}</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function logout() {
  try {
    await authApi.logout();
  } catch {
    /* đăng xuất là best effort: lỗi vẫn xóa phiên ở máy */
  }
  const signIn = session.loginAddress();
  session.clear();
  navigate(signIn);
}

function wireSidebar(root) {
  const side = root.querySelector('.adm-side');
  const toggle = root.querySelector('[data-adm-menu]');
  const setOpen = (open) => {
    side.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!side.classList.contains('is-open')));
  side.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !side.classList.contains('is-open')) return;
    setOpen(false);
    toggle.focus();
  });
  root.querySelector('#nav-logout').addEventListener('click', logout);
}

/** Hiện sidebar trên route admin và gỡ đi ở mọi nơi khác. Người chỉ có quyền AI chỉ tới một trang admin, nên không có sidebar. */
export function syncAdminNav(isAdminRoute, address = window.location.pathname) {
  const root = document.getElementById('admin-nav-root');
  if (!root) return;
  const show = Boolean(isAdminRoute) && session.isAdmin();
  root.hidden = !show;
  document.body.classList.toggle('adm-has-side', show);
  if (!show) {
    render(root, '');
    return;
  }
  render(root, adminNavMarkup(address));
  wireSidebar(root);
  paintCounts();
  refreshCounts();
}

/* ---------- thanh trên: tìm nhanh và ngôn ngữ ---------- */

const SEARCH_TARGETS = [
  { href: '/admin/players', label: 'Người chơi', note: 'tên hoặc email' },
  { href: '/admin/items', label: 'Vật phẩm', note: 'tên hoặc mã' },
  { href: '/admin/cases', label: 'Vụ án', note: 'tên hoặc mã' },
];

export function adminTopMarkup() {
  return `
    <div class="adm-top">
      <form class="adm-search" role="search" data-adm-search>
        <label class="adm-search-box">
          ${icon('search', 18)}
          <span class="bpa-sr">${tr('Search the admin pages', 'Tìm trong trang quản trị')}</span>
          <input type="search" name="q" autocomplete="off" placeholder="${tr('Find players, items, cases…', 'Tìm người chơi, vật phẩm, vụ án…')}">
        </label>
        <div class="adm-search-menu" id="adm-search-menu" hidden></div>
      </form>
      <div class="adm-top-tools">${languageSwitchMarkup('adm-lang')}</div>
    </div>`;
}

function wireSearch(root) {
  const form = root.querySelector('[data-adm-search]');
  if (!form) return;
  const input = form.querySelector('input');
  const menu = form.querySelector('.adm-search-menu');
  const links = () => [...menu.querySelectorAll('a')];
  const close = () => { menu.hidden = true; };
  const paint = () => {
    const q = input.value.trim();
    if (!q) {
      close();
      return;
    }
    menu.innerHTML = SEARCH_TARGETS.map((target, index) => `
      <a href="${target.href}?q=${encodeURIComponent(q)}"${index === 0 ? ' class="is-current"' : ''}>
        ${escapeHtml(target.label)}: “${escapeHtml(q)}”<small>${escapeHtml(target.note)}</small>
      </a>`).join('');
    menu.hidden = false;
  };
  input.addEventListener('input', paint);
  input.addEventListener('focus', paint);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowDown' && !menu.hidden) {
      event.preventDefault();
      links()[0]?.focus();
    }
  });
  menu.addEventListener('keydown', (event) => {
    const items = links();
    const at = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[Math.min(items.length - 1, at + 1)]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (at <= 0 ? input : items[at - 1]).focus(); }
    if (event.key === 'Escape') { close(); input.focus(); }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const first = links()[0];
    if (!first) return;
    close();
    navigate(first.getAttribute('href'));
  });
  form.addEventListener('focusout', (event) => {
    if (!form.contains(event.relatedTarget)) close();
  });
  menu.addEventListener('click', close);
  // Safari does not focus a link on click: without this the box blurs on mousedown, the menu hides, and the click is lost.
  menu.addEventListener('mousedown', (event) => event.preventDefault());
}

/**
 * Đặt vùng admin cho route hiện tại. Trả về true khi thanh trên của admin đã thay thanh điều hướng người chơi,
 * để router khỏi vẽ thanh người chơi. Người chỉ có quyền AI vẫn dùng thanh người chơi nhưng trang mang giao diện admin.
 */
export function syncAdminArea(route) {
  const body = document.body;
  const navRoot = document.getElementById('nav-root');
  const inArea = Boolean(route && (route.admin || route.aiAccess) && session.isLoggedIn());
  if (inArea) body.dataset.area = 'admin';
  else delete body.dataset.area;
  const ownTop = inArea && session.isAdmin();
  navRoot?.classList.toggle('adm-topbar', ownTop);
  if (!ownTop || !navRoot) return false;
  body.classList.remove('has-game-menu');
  render(navRoot, adminTopMarkup());
  wireSearch(navRoot);
  return true;
}
