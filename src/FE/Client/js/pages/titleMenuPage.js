import { DoorOpen, Fingerprint, FolderSearch, LogOut, Play, Users, createIcons } from 'lucide';
import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { languageSwitchMarkup, tr } from '../services/i18n.js';
import { escapeHtml, initials, render } from '../utils/dom.js';

export function renderTitleMenuPage(app) {
  const user = session.user();

  render(app, `
    <main class="title-menu-screen" aria-labelledby="title-menu-heading">
      <div class="title-menu-atmosphere" aria-hidden="true"></div>

      <header class="title-menu-utility">
        <div class="title-menu-detective">
          <span class="title-menu-avatar" aria-hidden="true">${escapeHtml(initials(user?.fullName || 'Detective'))}</span>
          <span>
            <small>${tr('SIGNED IN AS', 'ĐĂNG NHẬP VỚI')}</small>
            <strong>${escapeHtml(user?.fullName || tr('Detective', 'Thám tử'))}</strong>
          </span>
        </div>
        ${languageSwitchMarkup('title-menu-language')}
      </header>

      <section class="title-menu-stage">
        <div class="title-menu-lock" aria-hidden="true"><span></span></div>
        <p class="title-menu-kicker">221B · ${tr('INVESTIGATION UNIT', 'ĐƠN VỊ ĐIỀU TRA')}</p>
        <h1 id="title-menu-heading">SIR<span>LOCKED</span></h1>
        <p class="title-menu-tagline">${tr('Two detectives. One locked case.', 'Hai thám tử. Một vụ án bí ẩn.')}</p>

        <nav class="title-menu-actions" aria-label="${tr('Game menu', 'Menu trò chơi')}">
          <a class="title-menu-action is-primary" href="#/cases">
            <span class="title-menu-action-icon" aria-hidden="true"><i data-lucide="play"></i></span>
            <span class="title-menu-action-copy">
              <strong>${tr('BEGIN INVESTIGATION', 'BẮT ĐẦU PHÁ ÁN')}</strong>
              <small>${tr('Choose a case and assemble your team', 'Chọn vụ án và tập hợp đội điều tra')}</small>
            </span>
          </a>
          <a class="title-menu-action" href="#/join">
            <span class="title-menu-action-icon" aria-hidden="true"><i data-lucide="door-open"></i></span>
            <span class="title-menu-action-copy">
              <strong>${tr('JOIN A ROOM', 'VÀO PHÒNG')}</strong>
              <small>${tr('Enter an investigation code', 'Nhập mã phiên điều tra')}</small>
            </span>
          </a>
          <a class="title-menu-action" href="#/detective">
            <span class="title-menu-action-icon" aria-hidden="true"><i data-lucide="fingerprint"></i></span>
            <span class="title-menu-action-copy">
              <strong>${tr('DETECTIVE PROFILE', 'HỒ SƠ THÁM TỬ')}</strong>
              <small>${tr('Review your record and achievements', 'Xem thành tích và hồ sơ của bạn')}</small>
            </span>
          </a>
          <button class="title-menu-action title-menu-action--exit" id="title-menu-logout" type="button">
            <span class="title-menu-action-icon" aria-hidden="true"><i data-lucide="log-out"></i></span>
            <span class="title-menu-action-copy">
              <strong>${tr('LEAVE 221B', 'RỜI 221B')}</strong>
              <small>${tr('Sign out of SirLocked', 'Đăng xuất khỏi SirLocked')}</small>
            </span>
          </button>
        </nav>
      </section>

      <footer class="title-menu-footer">
        <a href="#/workshop"><i data-lucide="users" aria-hidden="true"></i>${tr('Community cases', 'Vụ án cộng đồng')}</a>
        <span aria-hidden="true"></span>
        <a href="#/create-room"><i data-lucide="folder-search" aria-hidden="true"></i>${tr('Host an investigation', 'Mở phiên điều tra')}</a>
      </footer>
    </main>`);

  createIcons({
    icons: { DoorOpen, Fingerprint, FolderSearch, LogOut, Play, Users },
    attrs: { 'aria-hidden': 'true' },
  });

  app.querySelector('#title-menu-logout')?.addEventListener('click', async () => {
    try {
      await authApi.logout();
    } catch {
      // Local sign-out still succeeds if the server cannot revoke the token.
    }
    session.clear();
    window.location.hash = '#/login';
  });
}
