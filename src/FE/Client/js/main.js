import { session } from './services/session.js';
import { authApi } from './api/authApi.js';
import { escapeHtml, render } from './utils/dom.js';
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

const routes = [
  { pattern: /^#\/login$/, page: renderLoginPage, anonymous: true },
  { pattern: /^#\/oauth-callback/, page: renderOAuthCallbackPage, anonymous: true },
  { pattern: /^#\/verify-email/, page: renderVerifyEmailPage, anonymous: true },
  { pattern: /^#\/reset-password/, page: renderResetPasswordPage, anonymous: true },
  { pattern: /^#\/verify-notice$/, page: renderVerifyNoticePage },
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
  if (!user) {
    render(navRoot, '');
    return;
  }
  const adminLinks = session.isAdmin()
    ? `<a href="#/admin" class="nav-link">${tr('Dashboard', 'Tổng quan')}</a>
       <a href="#/admin/cases" class="nav-link">${tr('Manage Cases', 'Quản lý vụ án')}</a>
       <a href="#/admin/weekly" class="nav-link">${tr('Weekly', 'Hàng tuần')}</a>`
    : '';
  const aiLinks = session.canGenerateAi()
    ? `<a href="#/admin/ai" class="nav-link">${tr('AI Creator', 'Tạo vụ án AI')}</a>`
    : '';
  const roleChip = session.isAdmin()
    ? ' <span class="chip chip-gold">ADMIN</span>'
    : session.isVip()
      ? ' <span class="chip chip-gold">VIP</span>'
      : '';
  render(navRoot, `
    <nav class="app-nav">
      <a class="nav-brand" href="#/cases">SIR<span>LOCKED</span></a>
      <div class="nav-links">
        <a href="#/cases" class="nav-link">${tr('Cases', 'Vụ án')}</a>
        <a href="#/workshop" class="nav-link">${tr('Workshop', 'Cộng đồng')}</a>
        <a href="#/create-room" class="nav-link">${tr('Create Room', 'Tạo phòng')}</a>
        <a href="#/join" class="nav-link">${tr('Join Room', 'Vào phòng')}</a>
        <a href="#/detective" class="nav-link">${tr('Profile', 'Hồ sơ')}</a>
        ${adminLinks}
        ${aiLinks}
      </div>
      <div class="nav-user">
        ${languageSwitchMarkup('ui-language-switch-nav')}
        <span class="nav-username">${escapeHtml(user.fullName)}${roleChip}</span>
        <button class="btn btn-ghost btn-sm" id="nav-logout">${tr('Log out', 'Đăng xuất')}</button>
      </div>
    </nav>`);
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
      ? (session.isAdmin() ? '#/admin' : session.isVip() ? '#/admin/ai' : '#/cases')
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
