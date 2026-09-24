import { renderLoginPage } from './pages/loginPage.js';
import { renderCasesPage } from './pages/casesPage.js';
import { renderCaseDetailPage } from './pages/caseDetailPage.js';
import { renderCreateRoomPage } from './pages/createRoomPage.js';
import { renderJoinRoomPage } from './pages/joinRoomPage.js';
import { renderLobbyPage } from './pages/lobbyPage.js';
import { renderResultPage } from './pages/resultPage.js';
import { renderAdminDashboardPage } from './pages/adminDashboardPage.js';
import { renderAdminCasesPage } from './pages/adminCasesPage.js';
import { renderAdminCaseDetailPage } from './pages/adminCaseDetailPage.js';
import { renderAdminImportPage } from './pages/adminImportPage.js';
import { renderOAuthCallbackPage } from './pages/oauthCallbackPage.js';
import { renderVerifyEmailPage } from './pages/verifyEmailPage.js';
import { renderResetPasswordPage } from './pages/resetPasswordPage.js';
import { renderVerifyNoticePage } from './pages/verifyNoticePage.js';
import { session } from './services/session.js';
import { authApi } from './api/authApi.js';
import { setUiLanguage, uiLanguage } from './services/i18n.js';
const routes = [
  { pattern: /^#\/login$/, page: renderLoginPage, anonymous: true },
  { pattern: /^#\/oauth-callback/, page: renderOAuthCallbackPage, anonymous: true },
  { pattern: /^#\/verify-email/, page: renderVerifyEmailPage, anonymous: true },
  { pattern: /^#\/reset-password/, page: renderResetPasswordPage, anonymous: true },
  { pattern: /^#\/verify-notice$/, page: renderVerifyNoticePage },
  { pattern: /^#\/cases$/, page: renderCasesPage },
  { pattern: /^#\/cases\/([^/]+)$/, page: renderCaseDetailPage },
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
  { pattern: /^#\/admin$/, page: renderAdminDashboardPage, admin: true },
  { pattern: /^#\/admin\/cases$/, page: renderAdminCasesPage, admin: true },
  { pattern: /^#\/admin\/cases\/([^/]+)$/, page: renderAdminCaseDetailPage, admin: true },
  { pattern: /^#\/admin\/import$/, page: renderAdminImportPage, admin: true },
];

const day = 4;
let cleanup = null;
const links = [['#/home','Trang chính'],['#/login','Tài khoản']];
if (day>=3) links.push(['#/cases','Vụ án'],['#/create-room','Tạo phòng'],['#/join','Vào phòng']);
if (day>=6) links.push(['#/detective','Hồ sơ'],['#/workshop','Cộng đồng']);
async function route() {
 if (typeof cleanup === 'function') await cleanup(); cleanup=null;
 document.documentElement.lang=uiLanguage();
 const app=document.getElementById('app');
 const hash=location.hash || '#/home';
 const visible=[...links];
 if(session.isAdmin() && day>=3) visible.push(['#/admin','Quản trị'],['#/admin/cases','Quản lý vụ án'],['#/admin/import','Import vụ án']);
 if(session.canGenerateAi() && day>=6) visible.push(['#/admin/ai','Tạo vụ án AI']);
 document.getElementById('nav-root').innerHTML='<nav class="page">'+visible.map(([url,title])=>`<a class="btn btn-ghost" href="${url}">${title}</a>`).join('')+(session.isLoggedIn()?'<button class="btn" id="handoff-logout">Đăng xuất</button>':'')+'</nav>';
 document.getElementById('handoff-logout')?.addEventListener('click',async()=>{try{await authApi.logout();}catch{} session.clear();location.hash='#/home';route();});
 const match=routes.map(r=>({r,m:hash.match(r.pattern)})).find(x=>x.m);
 document.body.classList.toggle('game-page-active',match?.r.game===true);
 document.body.classList.toggle('title-menu-active',match?.r.titleMenu===true);
 if(!match) { app.innerHTML='<section class="page"><h1>SirLocked</h1><p>Phiên bản bàn giao ngày '+day+'. Chọn một chức năng ở thanh điều hướng.</p></section>'; return; }
 const {r,m}=match;
 if(!r.anonymous && !session.isLoggedIn()) {location.hash='#/login';return;}
 if(r.admin && !session.isAdmin()) {location.hash='#/home';return;}
 if(r.aiAccess && !session.canGenerateAi()) {location.hash='#/home';return;}
 if(r.requiresVerified && !session.isEmailVerified()) {location.hash='#/verify-notice';return;}
 try {cleanup=await r.page(app,...m.slice(1));} catch(error) {app.textContent='Không thể mở chức năng: '+error.message;}
}
window.addEventListener('hashchange',route);
window.addEventListener('DOMContentLoaded',route);
document.addEventListener('click',e=>{const lang=e.target.closest?.('[data-ui-language]')?.dataset.uiLanguage;if(lang){setUiLanguage(lang);route();}});
