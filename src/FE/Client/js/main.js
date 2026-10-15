import { session } from './services/session.js';
import { createRouteLifecycle } from './services/routeLifecycle.js';
import { inviteCodeFromHash, rememberRoomInvite } from './services/roomInvites.js';
import { authApi } from './api/authApi.js';
import { profileApi } from './api/profileApi.js';
import { escapeHtml, initials, render } from './utils/dom.js';
import { languageSwitchMarkup, setUiLanguage, tr, uiLanguage } from './services/i18n.js';
import { renderLoginPage } from './pages/loginPage.js';
import { renderCasesPage } from './pages/casesPage.js';
import { renderCaseDetailPage } from './pages/caseDetailPage.js';
import { renderCreateRoomPage } from './pages/createRoomPage.js';
import { renderJoinRoomPage } from './pages/joinRoomPage.js';
import { renderLobbyPage } from './pages/lobbyPage.js';
import { renderResultPage } from './pages/resultPage.js';
import { renderWorkshopPage } from './pages/workshopPage.js';
import { renderWorkshopCasePage } from './pages/workshopCasePage.js';
import { renderDetectivePage } from './pages/detectivePage.js';
import { renderAdminDashboardPage } from './pages/adminDashboardPage.js';
import { renderAdminCasesPage } from './pages/adminCasesPage.js';
import { renderAdminCaseDetailPage } from './pages/adminCaseDetailPage.js';
import { renderAdminImportPage } from './pages/adminImportPage.js';
import { renderAdminAiPage } from './pages/adminAiPage.js';
import { renderChallengePage } from './pages/challengePage.js';
import { renderWeeklyAdminPage } from './pages/weeklyAdminPage.js';
import { renderOAuthCallbackPage } from './pages/oauthCallbackPage.js';
import { renderVerifyEmailPage } from './pages/verifyEmailPage.js';
import { renderResetPasswordPage } from './pages/resetPasswordPage.js';
import { renderVerifyNoticePage } from './pages/verifyNoticePage.js';
import { PROFILE_EVENT, detectiveRankLabel, renderTitleMenuPage } from './pages/titleMenuPage.js';

/**
 * Loading screen (markup lives in index.html so it can show before this
 * module runs). It only appears when a wait outlasts LOADING_DELAY_MS.
 */
const LOADING_DELAY_MS = 300;
const BOOT_LOADING_CAP_MS = 10_000;
const loadingScreen = (() => {
  let timer = 0;
  const node = () => document.getElementById('bpa-loading');
  return {
    show() {
      const el = node();
      if (!el || el.classList.contains('is-booting') || el.classList.contains('is-visible')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        el.hidden = false;
        el.classList.add('is-visible');
      }, LOADING_DELAY_MS);
    },
    hide() {
      clearTimeout(timer);
      const el = node();
      if (!el) return;
      el.classList.remove('is-visible', 'is-booting');
      el.hidden = true;
    },
  };
})();
setTimeout(() => loadingScreen.hide(), BOOT_LOADING_CAP_MS);

const routes = [
  { pattern: /^#\/login(?:\?[^#]*)?$/, page: renderLoginPage, anonymous: true, authScreen: true },
  { pattern: /^#\/oauth-callback/, page: renderOAuthCallbackPage, anonymous: true, authScreen: true },
  { pattern: /^#\/verify-email/, page: renderVerifyEmailPage, anonymous: true, authScreen: true },
  { pattern: /^#\/reset-password/, page: renderResetPasswordPage, anonymous: true, authScreen: true },
  { pattern: /^#\/verify-notice$/, page: renderVerifyNoticePage, authScreen: true },
  { pattern: /^#\/menu$/, page: renderTitleMenuPage, titleMenu: true },
  { pattern: /^#\/cases$/, page: renderCasesPage },
  { pattern: /^#\/cases\/([^/]+)$/, page: renderCaseDetailPage },
  { pattern: /^#\/workshop$/, page: renderWorkshopPage },
  { pattern: /^#\/workshop\/challenge$/, page: renderChallengePage },
  { pattern: /^#\/workshop\/([^/]+)$/, page: renderWorkshopCasePage },
  { pattern: /^#\/create-room$/, page: renderCreateRoomPage, requiresVerified: true },
  { pattern: /^#\/join(?:\?[^#]*)?$/, page: renderJoinRoomPage, requiresVerified: true },
  { pattern: /^#\/lobby\/([^/]+)$/, page: renderLobbyPage, requiresVerified: true, lifecycle: true },
  {
    pattern: /^#\/game\/([^/]+)$/,
    page: async (app, roomId, context) => {
      loadingScreen.show();
      let renderGamePage;
      try {
        ({ renderGamePage } = await import('./pages/gamePage.ts'));
      } finally {
        loadingScreen.hide();
      }
      if (context.signal.aborted) return;
      return renderGamePage(app, roomId, context);
    },
    lifecycle: true,
    requiresVerified: true,
    game: true,
  },
  { pattern: /^#\/result\/([^/]+)$/, page: renderResultPage },
  { pattern: /^#\/detective$/, page: renderDetectivePage },
  { pattern: /^#\/detective\/([^/]+)$/, page: renderDetectivePage },
  { pattern: /^#\/admin\/weekly$/, page: renderWeeklyAdminPage, admin: true },
  { pattern: /^#\/admin$/, page: renderAdminDashboardPage, admin: true },
  { pattern: /^#\/admin\/cases$/, page: renderAdminCasesPage, admin: true },
  { pattern: /^#\/admin\/cases\/([^/]+)$/, page: renderAdminCaseDetailPage, admin: true },
  { pattern: /^#\/admin\/import$/, page: renderAdminImportPage, admin: true },
  { pattern: /^#\/admin\/ai$/, page: renderAdminAiPage, aiAccess: true },
];

const routeLifecycle = createRouteLifecycle();

/* ---------- header: profile chip with the real rank ---------- */

// One /profile/me per signed-in user; the home page shares its own copy via PROFILE_EVENT.
let navProfile = { userId: '', profile: null, requested: false };

function navAccountRole() {
  if (session.isAdmin()) return 'ADMIN';
  if (session.isVip()) return 'VIP';
  return '';
}

function navRankText() {
  const role = navAccountRole();
  const rank = navProfile.profile ? detectiveRankLabel(navProfile.profile.rank) : '';
  if (rank) return role ? `${rank} · ${role}` : rank;
  return role || tr('Detective', 'Thám tử');
}

function applyNavProfile(profile) {
  const user = session.user();
  if (!user || !profile || (profile.userId && profile.userId !== user.userId)) return;
  navProfile = { userId: user.userId, profile, requested: true };
  const chip = document.getElementById('nav-profile');
  if (!chip) return;
  const rankText = navRankText();
  chip.querySelector('[data-nav-rank]').textContent = rankText;
  chip.setAttribute('aria-label', `${tr('Detective profile', 'Hồ sơ thám tử')}: ${user.fullName || ''}, ${rankText}`);
}

function requestNavProfile(user) {
  if (navProfile.userId === user.userId && navProfile.requested) return;
  navProfile = { userId: user.userId, profile: null, requested: true };
  profileApi.me().then(applyNavProfile).catch(() => {
    // The chip keeps the account role; the home page retries with its own request.
  });
}

window.addEventListener(PROFILE_EVENT, (event) => applyNavProfile(event.detail));

/* ---------- header markup ---------- */

const ICON_CHEVRON = '<svg class="bpa-shell-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_LOGOUT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';

function brandMarkup() {
  return `
    <a class="bpa-shell-brand" href="${session.isAdmin() ? '#/admin' : '#/menu'}"
       aria-label="${tr('Sir Locked, back to the home page', 'Sir Locked, về trang chủ')}">
      <span class="bpa-shell-mark" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="bpa-shell-word">SIR <span>LOCKED</span></span>
    </a>`;
}

function activeHref(hrefs) {
  // Longest prefix wins so #/admin/cases does not also light up #/admin.
  const hash = (window.location.hash || '#/menu').split('?')[0];
  return hrefs
    .filter((href) => hash === href || hash.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

function navLink({ href, label }, current) {
  return `<a href="${href}" class="bpa-shell-link${current === href ? ' is-active' : ''}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`;
}

function navGroup(id, label, items, current) {
  const open = items.some(({ href }) => href === current);
  return `
    <div class="bpa-shell-group" data-nav-group>
      <button type="button" class="bpa-shell-link bpa-shell-toggle${open ? ' is-active' : ''}"
              aria-expanded="false" aria-controls="${id}">${label}${ICON_CHEVRON}</button>
      <div class="bpa-shell-drop" id="${id}" hidden>
        ${items.map(({ href, label: itemLabel, note }) => `
          <a href="${href}" class="bpa-shell-drop-link${href === current ? ' is-active' : ''}"${href === current ? ' aria-current="page"' : ''}>
            <strong>${itemLabel}</strong><small>${note}</small>
          </a>`).join('')}
      </div>
    </div>`;
}

function closeNavGroups(except = null) {
  document.querySelectorAll('#nav-root [data-nav-group]').forEach((group) => {
    if (group === except) return;
    group.querySelector('.bpa-shell-toggle')?.setAttribute('aria-expanded', 'false');
    const drop = group.querySelector('.bpa-shell-drop');
    if (drop) drop.hidden = true;
  });
}

function renderNav(r) {
  const navRoot = document.getElementById('nav-root');
  const user = session.user();
  if (!user || r.authScreen) {
    document.body.classList.remove('has-game-menu');
    render(navRoot, '');
    return;
  }
  document.body.classList.add('has-game-menu');

  const logout = `
    <button class="bpa-shell-iconbtn" id="nav-logout" type="button"
            aria-label="${tr('Log out', 'Đăng xuất')}" title="${tr('Log out', 'Đăng xuất')}">${ICON_LOGOUT}</button>`;

  if (r.game) {
    // Gameplay keeps a quiet strip so the scene gets the whole frame.
    render(navRoot, `
      <div class="bpa-shell bpa-shell--game">
        ${brandMarkup()}
        <div class="bpa-shell-tools">${languageSwitchMarkup('ui-language-switch-nav')}${logout}</div>
      </div>`);
  } else {
    const roomItems = [
      { href: '#/create-room', label: tr('Create room', 'Tạo phòng'), note: tr('Host a new investigation', 'Mở phiên điều tra mới') },
      { href: '#/join', label: tr('Join room', 'Vào phòng'), note: tr('Enter a 6-character code', 'Nhập mã 6 ký tự') },
    ];
    const staffItems = [
      ...(session.isAdmin()
        ? [
          { href: '#/admin', label: tr('Dashboard', 'Tổng quan'), note: tr('Operations overview', 'Tổng quan điều hành') },
          { href: '#/admin/cases', label: tr('Manage cases', 'Quản lý vụ án'), note: tr('Case archive', 'Kho vụ án') },
          { href: '#/admin/weekly', label: tr('Weekly', 'Hàng tuần'), note: tr('Weekly desk', 'Bàn vụ án tuần') },
        ]
        : []),
      ...(session.canGenerateAi()
        ? [{ href: '#/admin/ai', label: tr('AI Creator', 'Tạo vụ án AI'), note: tr('Case forge', 'Xưởng vụ án') }]
        : []),
    ];
    const mainItems = [
      { href: '#/menu', label: tr('Home', 'Trang chủ') },
      { href: '#/cases', label: tr('Cases', 'Vụ án') },
      { href: '#/workshop', label: 'Workshop' },
    ];
    const current = activeHref([...mainItems, ...roomItems, ...staffItems, { href: '#/detective' }].map(({ href }) => href));
    const rankText = navRankText();

    render(navRoot, `
      <div class="bpa-shell">
        ${brandMarkup()}
        <nav class="bpa-shell-nav nav-links" aria-label="${tr('Main navigation', 'Điều hướng chính')}">
          ${navLink(mainItems[0], current)}
          ${navGroup('bpa-shell-rooms', tr('Rooms', 'Phòng'), roomItems, current)}
          ${navLink(mainItems[1], current)}
          ${navLink(mainItems[2], current)}
          ${staffItems.length ? navGroup('bpa-shell-staff', tr('Operations', 'Quản trị'), staffItems, current) : ''}
        </nav>
        <div class="bpa-shell-tools">
          ${languageSwitchMarkup('ui-language-switch-nav')}
          <a class="bpa-shell-profile${current === '#/detective' ? ' is-active' : ''}" id="nav-profile" href="#/detective"
             ${current === '#/detective' ? 'aria-current="page"' : ''}
             aria-label="${escapeHtml(`${tr('Detective profile', 'Hồ sơ thám tử')}: ${user.fullName || ''}, ${rankText}`)}">
            <span class="bpa-avatar" aria-hidden="true">${escapeHtml(initials(user.fullName))}</span>
            <span class="bpa-shell-id" aria-hidden="true">
              <strong>${escapeHtml(user.fullName || tr('Detective', 'Thám tử'))}</strong>
              <small data-nav-rank>${escapeHtml(rankText)}</small>
            </span>
          </a>
          ${logout}
        </div>
      </div>`);

    navRoot.querySelectorAll('[data-nav-group]').forEach((group) => {
      const toggle = group.querySelector('.bpa-shell-toggle');
      const drop = group.querySelector('.bpa-shell-drop');
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        closeNavGroups(group);
        toggle.setAttribute('aria-expanded', String(open));
        drop.hidden = !open;
      });
      group.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || drop.hidden) return;
        closeNavGroups();
        toggle.focus();
      });
      group.addEventListener('focusout', (event) => {
        if (!group.contains(event.relatedTarget)) closeNavGroups();
      });
    });

    if (!r.titleMenu) requestNavProfile(user);
  }

  navRoot.querySelector('#nav-logout').addEventListener('click', async () => {
    // Gọi API để thu hồi refresh token phía server (best effort)
    try {
      await authApi.logout();
    } catch {
      /* logout là best effort — kể cả lỗi vẫn xóa session local */
    }
    session.clear();
    window.location.hash = '#/login';
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest?.('#nav-root [data-nav-group]')) closeNavGroups();
});

/* ---------- router ---------- */

function matchRoute(hash) {
  return routes.map((r) => ({ r, m: hash.match(r.pattern) })).find((x) => x.m) || null;
}

async function route({ transition = true } = {}) {
  let hash = window.location.hash || '#/';
  const target = hash === '#/' || hash === '#' ? null : matchRoute(hash);
  // Redirects and gameplay skip the lens: Phaser measures its canvas on mount.
  const lens = transition && Boolean(target) && !target.r.game && (target.r.anonymous || session.isLoggedIn());
  const mount = routeLifecycle.begin(document.getElementById('app'), { transition: lens });
  const { app } = mount;

  if (hash === '#/' || hash === '#') {
    hash = session.isLoggedIn()
      ? (session.isAdmin() ? '#/admin' : '#/menu')
      : '#/login';
    window.location.hash = hash;
    return;
  }

  if (!target) {
    window.location.hash = '#/';
    return;
  }

  const { r, m } = target;
  if (!r.anonymous && !session.isLoggedIn()) {
    rememberRoomInvite(hash);
    window.location.hash = '#/login';
    return;
  }
  if (r.admin && !session.isAdmin()) {
    window.location.hash = '#/cases';
    return;
  }
  if (r.requiresVerified && !session.isEmailVerified()) {
    if (inviteCodeFromHash(hash)) {
      rememberRoomInvite(hash);
      window.location.hash = '#/verify-notice';
      return;
    }
    alert(tr(
      'You must verify your email before entering the game. Open Profile to verify it.',
      'Bạn cần xác minh email trước khi vào game. Vào trang Hồ sơ để xác minh.',
    ));
    window.location.hash = '#/detective';
    return;
  }
  if (r.aiAccess && !session.canGenerateAi()) {
    window.location.hash = '#/cases';
    return;
  }

  document.body.classList.toggle('game-page-active', r.game === true);
  document.body.classList.toggle('title-menu-active', r.titleMenu === true);
  // The cork board is the backdrop of every screen except the Phaser scene.
  document.body.classList.toggle('bpa-board', r.game !== true);
  renderNav(r);
  try {
    const args = r.lifecycle ? [...m.slice(1), { signal: mount.signal }] : m.slice(1);
    mount.setCleanup(await r.page(app, ...args));
  } catch (error) {
    if (!mount.active) return;
    mount.dispose();
    render(app, `<div class="page"><div class="empty-state" role="alert">${escapeHtml(tr('This page could not be loaded. Please try again.', 'Không thể tải trang này. Vui lòng thử lại.'))}</div></div>`);
    console.error('Page load failed', error);
  } finally {
    // A newer route owns the loading screen once this root has been replaced.
    if (app.isConnected) loadingScreen.hide();
  }
}

window.addEventListener('hashchange', () => route());
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = uiLanguage();
  route();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-ui-language]');
  const language = button?.dataset.uiLanguage;
  if (!language || language === uiLanguage()) return;
  setUiLanguage(language);
  route({ transition: false });
});
