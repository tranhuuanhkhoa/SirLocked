import { session } from './services/session.js';
import { authApi } from './api/authApi.js';
import { Award, Briefcase, Crown, Folder, FolderSearch, Gamepad2, Lightbulb, Timer, Users, X, createIcons } from 'lucide';
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
import { renderTitleMenuPage } from './pages/titleMenuPage.js';

const routes = [
  { pattern: /^#\/login$/, page: renderLoginPage, anonymous: true },
  { pattern: /^#\/oauth-callback/, page: renderOAuthCallbackPage, anonymous: true },
  { pattern: /^#\/verify-email/, page: renderVerifyEmailPage, anonymous: true },
  { pattern: /^#\/reset-password/, page: renderResetPasswordPage, anonymous: true },
  { pattern: /^#\/verify-notice$/, page: renderVerifyNoticePage },
  { pattern: /^#\/menu$/, page: renderTitleMenuPage, titleMenu: true },
  { pattern: /^#\/cases$/, page: renderCasesPage },
  { pattern: /^#\/cases\/([^/]+)$/, page: renderCaseDetailPage },
  { pattern: /^#\/workshop$/, page: renderWorkshopPage },
  { pattern: /^#\/workshop\/challenge$/, page: renderChallengePage },
  { pattern: /^#\/workshop\/([^/]+)$/, page: renderWorkshopCasePage },
  { pattern: /^#\/create-room$/, page: renderCreateRoomPage, requiresVerified: true },
  { pattern: /^#\/join$/, page: renderJoinRoomPage, requiresVerified: true },
  { pattern: /^#\/lobby\/([^/]+)$/, page: renderLobbyPage, requiresVerified: true },
  {
    pattern: /^#\/game\/([^/]+)$/,
    page: async (...args) => (await import('./pages/gamePage.ts')).renderGamePage(...args),
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

let cleanup = null;

function renderNav() {
  const navRoot = document.getElementById('nav-root');
  const user = session.user();
  if (!user || document.body.classList.contains('title-menu-active')) {
    document.body.classList.remove('has-game-menu');
    render(navRoot, '');
    return;
  }
  document.body.classList.add('has-game-menu');

  const playerItems = [
    { href: '#/cases', label: tr('Cases', 'Vụ án'), note: tr('Choose an investigation', 'Chọn cuộc điều tra'), icon: 'folder-search' },
    { href: '#/workshop', label: tr('Workshop', 'Cộng đồng'), note: tr('Community case files', 'Hồ sơ cộng đồng'), icon: 'users' },
    { href: '#/create-room', label: tr('Create Room', 'Tạo phòng'), note: tr('Host a new session', 'Mở phiên điều tra'), icon: 'gamepad-2' },
    { href: '#/join', label: tr('Join Room', 'Vào phòng'), note: tr('Enter a room code', 'Nhập mã phòng'), icon: 'briefcase' },
    { href: '#/detective', label: tr('Profile', 'Hồ sơ'), note: tr('Detective record', 'Hồ sơ thám tử'), icon: 'award' },
  ];
  const staffItems = [
    ...(session.isAdmin()
      ? [
        { href: '#/admin', label: tr('Dashboard', 'Tổng quan'), note: tr('Operations overview', 'Tổng quan điều hành'), icon: 'crown' },
        { href: '#/admin/cases', label: tr('Manage Cases', 'Quản lý vụ án'), note: tr('Case archive', 'Kho vụ án'), icon: 'folder' },
        { href: '#/admin/weekly', label: tr('Weekly', 'Hàng tuần'), note: tr('Weekly desk', 'Bàn vụ án tuần'), icon: 'timer' },
      ]
      : []),
    ...(session.canGenerateAi()
      ? [{ href: '#/admin/ai', label: tr('AI Creator', 'Tạo vụ án AI'), note: tr('Case forge', 'Xưởng vụ án'), icon: 'lightbulb' }]
      : []),
  ];

  // Longest prefix wins so #/admin/cases does not also light up #/admin.
  const hash = window.location.hash || '#/cases';
  const activeHref = [...playerItems, ...staffItems]
    .map(({ href }) => href)
    .filter((href) => hash === href || hash.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  const navLink = ({ href, label, note, icon }, index) => {
    const current = href === activeHref;
    return `
      <a href="${href}" class="nav-link${current ? ' is-active' : ''}"${current ? ' aria-current="page"' : ''}>
        <span class="nav-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        <span class="nav-icon" aria-hidden="true"><i data-lucide="${icon}"></i></span>
        <span class="nav-copy"><strong>${label}</strong><small>${note}</small></span>
        <span class="nav-current" aria-hidden="true"></span>
      </a>`;
  };

  const accountRole = session.isAdmin()
    ? 'ADMIN'
    : session.isVip()
      ? 'VIP'
      : tr('DETECTIVE', 'THÁM TỬ');
  render(navRoot, `
    <nav class="app-nav game-menu panel panel--glass panel--rail" aria-label="${tr('Main menu', 'Menu chính')}">
      <div class="nav-top">
        <a class="nav-brand" href="${session.isAdmin() ? '#/admin' : '#/menu'}" aria-label="SirLocked">
          <span class="nav-brand-mark" aria-hidden="true"><span></span></span>
          <span class="nav-brand-copy"><strong>SIR<span>LOCKED</span></strong><small>221B INVESTIGATION UNIT</small></span>
        </a>
        <button class="nav-menu-toggle" id="nav-menu-toggle" type="button"
                aria-expanded="false" aria-controls="nav-menu-panel" aria-label="${tr('Open menu', 'Mở menu')}">
          <span></span><span></span><span></span>
        </button>
      </div>

      <div class="nav-links" id="nav-menu-panel">
        <section class="nav-zone nav-zone--player" aria-label="${tr('Play', 'Chơi')}">
          <div class="nav-section-label"><span>${tr('Main menu', 'Menu chính')}</span><small>${tr('Play', 'Chơi')}</small></div>
          ${playerItems.map(navLink).join('')}
        </section>
        ${staffItems.length ? `
          <section class="nav-zone nav-zone--staff" aria-label="${tr('Operations', 'Điều hành')}">
            <div class="nav-section-label"><span>${tr('Staff access', 'Khu quản trị')}</span><small>${tr('Operations', 'Điều hành')}</small></div>
            ${staffItems.map(navLink).join('')}
          </section>` : ''}
      </div>

      <div class="nav-user">
        <div class="nav-account">
          <span class="nav-avatar" aria-hidden="true">${escapeHtml(initials(user.fullName))}</span>
          <span class="nav-identity"><strong>${escapeHtml(user.fullName)}</strong><small>${accountRole}</small></span>
        </div>
        <div class="nav-utility">
          ${languageSwitchMarkup('ui-language-switch-nav')}
          <button class="btn btn-ghost btn-sm nav-logout" id="nav-logout">
            <i data-lucide="x" aria-hidden="true"></i><span>${tr('Log out', 'Đăng xuất')}</span>
          </button>
        </div>
      </div>
    </nav>`);

  createIcons({
    icons: { Award, Briefcase, Crown, Folder, FolderSearch, Gamepad2, Lightbulb, Timer, Users, X },
    attrs: { 'aria-hidden': 'true' },
  });

  const menu = navRoot.querySelector('.game-menu');
  const menuToggle = navRoot.querySelector('#nav-menu-toggle');
  menuToggle.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? tr('Close menu', 'Đóng menu') : tr('Open menu', 'Mở menu'));
  });
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

async function route() {
  const app = document.getElementById('app');
  if (typeof cleanup === 'function') {
    try {
      await cleanup();
    } catch {
      /* page cleanup is best effort */
    }
    cleanup = null;
  }

  let hash = window.location.hash || '#/';
  if (hash === '#/' || hash === '#') {
    hash = session.isLoggedIn()
      ? (session.isAdmin() ? '#/admin' : '#/menu')
      : '#/login';
    window.location.hash = hash;
    return;
  }

  const match = routes.map((r) => ({ r, m: hash.match(r.pattern) })).find((x) => x.m);
  if (!match) {
    window.location.hash = '#/';
    return;
  }

  const { r, m } = match;
  if (!r.anonymous && !session.isLoggedIn()) {
    window.location.hash = '#/login';
    return;
  }
  if (r.admin && !session.isAdmin()) {
    window.location.hash = '#/cases';
    return;
  }
  if (r.requiresVerified && !session.isEmailVerified()) {
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
  renderNav();
  cleanup = await r.page(app, ...m.slice(1));
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = uiLanguage();
  route();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-ui-language]');
  const language = button?.dataset.uiLanguage;
  if (!language || language === uiLanguage()) return;
  setUiLanguage(language);
  route();
});
