import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

export async function renderCasesPage(app) {
  render(app, `<div class="page"><p class="muted">${tr('Loading published cases…', 'Đang tải các vụ án…')}</p></div>`);

  let cases = [];
  try {
    cases = await caseApi.published();
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  const cards = cases.map((c) => `
    <article class="case-card" data-case="${escapeHtml(c.caseId)}">
      <div class="case-cover" style="${placeholderStyle(c.caseId)}">
        <img src="${escapeHtml(c.coverImageUrl)}" alt="" loading="lazy"
             onerror="this.remove()">
        <span class="case-cover-title">${escapeHtml(c.title)}</span>
      </div>
      <div class="case-body">
        <h3>${escapeHtml(c.title)}</h3>
        <p class="case-summary">${escapeHtml(c.summary)}</p>
        <div class="case-meta">
          <span class="chip">${c.estimatedMinutes} ${tr('min', 'phút')}</span>
          <span class="chip">${c.sceneCount} ${tr('scenes', 'hiện trường')}</span>
          <span class="chip">${c.characterCount} ${tr('suspects', 'nghi phạm')}</span>
          <span class="chip">${c.clueCount} ${tr('clues', 'manh mối')}</span>
        </div>
        <div class="case-actions">
          <a class="btn btn-ghost btn-sm" href="#/cases/${encodeURIComponent(c.caseId)}">${tr('Details', 'Chi tiết')}</a>
          <button class="btn btn-primary btn-sm" data-create="${escapeHtml(c.caseId)}">${tr('Create room', 'Tạo phòng')}</button>
        </div>
      </div>
    </article>`).join('');

  render(app, `
  <div class="page">
    <div class="page-head">
      <h2>${tr('Published Cases', 'Vụ án đã xuất bản')}</h2>
      <div class="case-actions">
        <a class="btn btn-primary" href="#/create-room">${tr('Create room', 'Tạo phòng')}</a>
        <a class="btn btn-ghost" href="#/join">${tr('Have a room code?', 'Đã có mã phòng?')}</a>
      </div>
    </div>
    ${cases.length === 0
      ? `<div class="empty-state">${tr('No cases are published yet. Ask an admin to publish a case.', 'Chưa có vụ án nào được xuất bản. Hãy yêu cầu quản trị viên xuất bản một vụ án.')}</div>`
      : `<div class="case-grid">${cards}</div>`}
  </div>`);

  app.querySelectorAll('[data-create]').forEach((button) =>
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const room = await roomApi.create(button.dataset.create);
        toast(`Room ${room.roomCode} created.`, 'success');
        window.location.hash = `#/lobby/${room.roomId}`;
      } catch (err) {
        toast(err.message, 'error');
        button.disabled = false;
      }
    }));
}
